# ARCHITECTURE.md — Distributed Wagering Processor

> Documento de Decisões de Arquitetura (ADR) para o Desafio Técnico da **Jungle Gaming**.

---

## 1. Visão Geral e Princípios Arquiteturais

O sistema foi desenhado sob os princípios de **Domain-Driven Design (DDD)**, **Clean Architecture** (Arquitetura Hexagonal / Ports & Adapters) e **Arquitetura Orientada a Eventos (EDA)**.

### Princípios Norteadores:
1. **Domínio Puro e Agnóstico:** O núcleo de negócio (`src/domain/`) não possui acoplamento com decorators de frameworks (NestJS) nem detalhes de infraestrutura/ORM (MikroORM/Postgres). Ele é composto por modelos ricos que garantem suas próprias invariantes.
2. **Correção Financeira Absoluta:** O estado contábil é suportado por um modelo de saldo materializado acompanhado de um **Ledger append-only e imutável**.
3. **Resiliência a Falhas Distribuídas:** Tolerância a falhas através de **Transactional Outbox**, **Transactional Inbox** e semântica *at-least-once* idempotente.
4. **Isolamento de Concorrência por Wallet:** A granularidade de lock é estritamente no escopo da carteira (`walletId`), permitindo alta vazão para carteiras distintas sem gargalos globais.

```
                      ┌───────────────────────────────────────┐
                      │             HTTP API / SQS            │
                      └──────────────────┬────────────────────┘
                                         ▼
                      ┌───────────────────────────────────────┐
                      │        Application / Use Cases        │
                      └──────────────────┬────────────────────┘
                                         ▼
                      ┌───────────────────────────────────────┐
                      │             Domain Core               │
                      │  (Wallet, Money, Ledger, WagerTx)     │
                      └──────────────────┬────────────────────┘
                                         ▼
                      ┌───────────────────────────────────────┐
                      │             Infrastructure            │
                      │   (Postgres/MikroORM, AWS SQS FIFO)   │
                      └───────────────────────────────────────┘
```

---

## 2. Escolha e Justificativa do ORM: MikroORM

Conforme preferência expressa do edital, adotamos o **MikroORM** em detrimento do TypeORM ou Prisma pelos seguintes motivos:

1. **Unit of Work & Identity Map:**
   - O MikroORM mantém um Identity Map explícito por transação/request (`Forked EntityManager`), garantindo que a mesma entidade recuperada múltiplas vezes no mesmo escopo aponte para a mesma referência em memória.
   - O Unit of Work gerencia automaticamente inserções, atualizações e deleções, executando-as de forma otimizada e ordenada no momento do `flush()`.
2. **Suporte Nativo a Locks Explícitos (`LockMode.PESSIMISTIC_WRITE`):**
   - Possibilita a emissão direta de `SELECT ... FOR UPDATE` no carregamento da `Wallet`, essencial para a resolução determinística de concorrência.
3. **Controle Transacional Rígido (`em.transactional()`):**
   - Permite agrupar alterações de saldo, lançamentos no ledger, deduplicação de inbox e agendamento de outbox no **mesmo commit SQL atômico**.

---

## 3. Modelo Monetário e Precisão Numérica (`Money`)

### Justificativa de Implementação:
- **Proibição de `number`/`float`:** Operações de ponto flutuante binário (IEEE 754) introduzem dízimas e imprecisões inaceitáveis no setor de iGaming (ex.: `0.1 + 0.2 === 0.30000000000000004`).
- **Precisão Arbitrária:** O Value Object `Money` utiliza internamente a biblioteca `decimal.js`.
- **Escala Fixa:** Os valores de entrada e saída são estritamente strings decimais com **exatamente 2 casas** (ex.: `"25.00"`).
- **Mapeamento no Banco de Dados:** No PostgreSQL, os valores monetários são persistidos na coluna do tipo `numeric(18, 2)` (ou `numeric(15, 2)`), que oferece armazenamento exato em base 10 suportado pelo banco.
- **Imutabilidade:** O objeto `Money` é estruturalmente imutável. Métodos como `add()`, `subtract()` e `negate()` retornam sempre uma nova instância.
- **Validação de Moeda:** Operações aritméticas entre moedas distintas disparam `CurrencyMismatchError`.

---

## 4. Estratégia de Concorrência e Ordenação

### Unidade de Concorrência: `walletId`
Para atender ao cenário eliminatório onde múltiplas requisições disputam o mesmo saldo em paralelo (ex.: duas apostas de R$ 80,00 sobre um saldo de R$ 100,00 com múltiplas instâncias da aplicação):

1. **Pessimistic Locking (`SELECT ... FOR UPDATE`):**
   - Ao iniciar a transação do caso de uso, a linha da `Wallet` correspondente é bloqueada com `LockMode.PESSIMISTIC_WRITE`.
   - O PostgreSQL serializa as requisições concorrentes da mesma carteira na ordem de chegada ao lock.
   - A primeira transação lê saldo `100.00`, debita `80.00`, insere o ledger com saldo pós `20.00`, insere outbox e commita.
   - A segunda transação, ao adquirir o lock, lê o saldo atualizado `20.00`, constata saldo insuficiente e rejeita a aposta (`REJECTED` com `failureCode: INSUFFICIENT_FUNDS`), sem lançar débito no ledger.
2. **Inexistência de Lock Global:**
   - Operações em carteiras distintas (`walletA` e `walletB`) processam em paralelo sem qualquer bloqueio mútuo.
3. **Versão Otimista (`version`):**
   - Mantida como mecanismo complementar de integridade e auditoria, incrementada exclusivamente quando o saldo é alterado.

---

## 5. Idempotência e Hashing Canônico

### Cabeçalho `Idempotency-Key`
- Toda requisição HTTP exige o cabeçalho `Idempotency-Key` (formato padrão: `"{providerId}:{externalTransactionId}"`).
- Na mensageria (SQS), o identificador de idempotência segue na mensagem.

### Algoritmo do Hash Canônico do Payload:
Para distinguir entre um **replay idempotente legítimo** e um **conflito de payload com mesma chave**:
1. Extrai-se o subconjunto de campos estritamente de negócio: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money.amount`, `money.currency`, `referenceExternalTransactionId`.
2. Ordenam-se as chaves recursivamente em ordem alfabética (*Canonical JSON*).
3. Gera-se o hash criptográfico **SHA-256** em formato hexadecimal (`payloadHash`).

### Resolução de Estados:
- **Mesma Idempotency-Key + Mesmo PayloadHash:** Retorna a resposta original memorizada com flag `"idempotentReplay": true`.
- **Mesma Idempotency-Key + PayloadHash Diferente:** Rejeição com erro de conflito (`409 Conflict` ou status com `failureCode: IDEMPOTENCY_CONFLICT`).

---

## 6. Padrões Transactional Outbox e Transactional Inbox

### 6.1 Transactional Outbox (Publicação Confiável)
- Para evitar a perda de eventos em caso de falha de rede pós-commit, os eventos de domínio (`WalletBalanceChanged`, `WagerTransactionProcessed`, etc.) são serializados e salvos na tabela `outbox_messages` **na mesma transação SQL** que alterou a Wallet e o Ledger.
- Um worker independente lê mensagens pendentes utilizando `SELECT ... FOR UPDATE SKIP LOCKED` para permitir múltiplos publishers concorrentes sem colisão, publicando para o AWS SQS e marcando como `publishedAt` com suporte a retry e backoff exponencial.

### 6.2 Transactional Inbox (Consumo Confiável)
- O consumidor SQS registra cada mensagem na tabela `inbox_messages` usando a chave única `(consumer_name, message_id)`.
- Se a mensagem já existir no inbox, o worker faz o `ACK` sem reprocessar, garantindo idempotência frente à semântica *at-least-once* do broker.
- O `ACK` no SQS só ocorre **após o commit completo da transação SQL**.

---

## 7. Decisão sobre Autenticação (Identity Provider Externo)

Conforme seção 2 do edital, autenticação não compõe pontuação na grade de avaliação e não substitui os requisitos de correção financeira e concorrência.

### Decisão de Desenho:
- O sistema é concebido para delegar autenticação e emissão de credenciais a um **Identity Provider externo (ex.: Keycloak ou Zitadel)** via OpenID Connect (OIDC) / OAuth2.
- A aplicação atua como Resource Server validando tokens JWT assinados via JWKS (JSON Web Key Set).
- No código, definimos a porta de extensão `ProviderIdentityPort` e um `AuthGuard` estruturado, permitindo validar a correspondência entre o `client_id` autenticado do provedor e o `providerId` submetido nas transações.
- Endpoints de `/health/live` e `/health/ready` permanecem desprotegidos.

---

## 8. Taxonomia de Códigos de Falha (`FailureCode`)

| Código | Significado | Recuperável pelo Provedor? |
|---|---|---|
| `INSUFFICIENT_FUNDS` | Carteira sem saldo para aposta ou reversão | Não (depende de depósito) |
| `INVALID_REFERENCE` | Operação requer referência que não foi informada | Não (requisição inválida) |
| `REFERENCE_NOT_FOUND` | Transação referenciada não existe ou expirou | Depende (aguarda retry ou desiste) |
| `REFERENCE_ALREADY_REVERTED`| Transação já foi revertida anteriormente | Não |
| `AMOUNT_MISMATCH` | Valor da reversão difere da transação original | Não |
| `CURRENCY_MISMATCH` | Moeda incompatível com a carteira ou referência | Não |
| `ROUND_MISMATCH` | Transação de rodada diferente da referência | Não |
| `PLAYER_MISMATCH` | Jogador divergente da referência ou carteira | Não |
| `INVALID_OPERATION_TYPE` | Reversão sobre tipo incompatível de operação | Não |
| `REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE`| Reversão levaria o saldo para negativo | Não |
| `IDEMPOTENCY_CONFLICT` | Mesma chave de idempotência com payload divergente | Não |
| `INFRASTRUCTURE_FAILURE` | Erro permanente interno | Sim (contatar suporte) |
