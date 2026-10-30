# Distributed Wagering Processor — Jungle Gaming 🦧

Serviço financeiro distribuído de alta performance para processamento de transações de apostas de múltiplos provedores de cassino online (iGaming).

Desenvolvido com foco em **correção financeira absoluta**, **concorrência determinística com múltiplas instâncias**, **idempotência persistente**, **ledger append-only imutável** e **resiliência a falhas distribuídas**.

---

## 🚀 Tecnologias

- **Runtime & Test Runner:** [Bun 1.x](https://bun.sh/)
- **Linguagem:** TypeScript em modo estrito (`strict: true`)
- **Framework Web:** [NestJS 11](https://nestjs.com/)
- **Banco de Dados:** [PostgreSQL 16](https://www.postgresql.org/) com constraints nativas de integridade
- **ORM:** [MikroORM 6](https://mikro-orm.io/) (Unit of Work, Identity Map explícito, `SELECT ... FOR UPDATE`)
- **Mensageria:** AWS SQS FIFO via [LocalStack 3.7](https://localstack.cloud/)
- **Aritmética Monetária:** `decimal.js` (escala fixa de 2 casas, zero float/number)
- **Orquestração:** Docker Compose

---

## 📋 Pré-requisitos

- [Docker](https://www.docker.com/) e Docker Compose
- [Bun](https://bun.sh/) (`curl -fsSL https://bun.sh/install | bash`)

---

## 🛠️ Inicialização Rápida

### 1. Clonar e Instalar Dependências
```bash
bun install
```

### 2. Subir Infraestrutura (PostgreSQL + LocalStack SQS FIFO)
```bash
docker compose up -d
```
> O LocalStack cria automaticamente as filas FIFO `wager-transactions.fifo` e a Dead Letter Queue `wager-transactions-dlq.fifo` com política de redrive (`maxReceiveCount: 3`).

### 3. Executar as Migrations do Banco de Dados
```bash
bun run migrate
```

### 4. Iniciar a Aplicação
```bash
# Modo desenvolvimento com hot-reload
bun run start:dev

# Ou execução direta com Bun
bun run src/main.ts
```

A API estará disponível em: `http://localhost:3000`

---

## 🧪 Bateria de Testes

O projeto conta com mais de **60 testes automatizados** cobrindo todas as exigências eliminatórias do edital.

```bash
# Executar todos os testes
bun test

# Testes de unidade do domínio (Money, Wallet, WagerTransaction, Ledger)
bun run test:unit

# Testes de integração (Constraints PostgreSQL, Use Cases, Outbox, SQS)
bun run test:integration

# Testes de concorrência real (Pessimistic Locking & 50 requisições simultâneas)
bun run test:concurrency

# Teste de carga e benchmark de estresse (Diferencial)
bun run test:load
```

---

## 📑 Principais Cenários Validados

1. **Cenário Eliminatório de Concorrência (Seção 8 do Edital):**
   - Saldo inicial R$ 100,00. Duas apostas de R$ 80,00 disparadas no mesmo milissegundo em paralelo absoluto.
   - **Resultado:** Exatamente 1 aposta `PROCESSED`, a outra `REJECTED` por saldo insuficiente (`INSUFFICIENT_FUNDS`), saldo final R$ 20,00 e exatamente 1 lançamento de débito no ledger.
2. **50 Requisições Simultâneas com a Mesma Idempotency-Key:**
   - Exatamente 1 débito é aplicado; as outras 49 recebem o replay idempotente com o saldo correspondente (`idempotentReplay: true`).
3. **Impossibilidade de Saldo Negativo:**
   - Garantida no domínio (`InsufficientBalanceError`) e no schema do banco via `CONSTRAINT chk_wallet_balance_positive CHECK (balance >= 0)`.
4. **Reversão com Saldo Insuficiente (Regra 7.9):**
   - Reversão (`ROLLBACK`) de um prêmio que produziria saldo negativo é rejeitada explicitamente com `REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE`.
5. **Transactional Outbox & Inbox:**
   - Despacho concorrente sem duplicação via `SELECT ... FOR UPDATE SKIP LOCKED`.
   - Consumo SQS com deduplicação física no banco via `(consumer_name, message_id)` e ACK somente após o commit SQL.

---

## 🌐 Endpoints da API HTTP

### 1. Health Checks (Abertos, sem autenticação)
- `GET /health/live` — Liveness check do processo.
- `GET /health/ready` — Readiness check validando conectividade com PostgreSQL e LocalStack SQS.

### 2. Criar Carteira
```http
POST /wallets
Content-Type: application/json

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```

### 3. Consultar Carteira
```http
GET /wallets/:walletId
```

### 4. Consultar Extrato (Ledger com Cursor Estável)
```http
GET /wallets/:walletId/ledger?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2...
```

### 5. Submeter Transação de Aposta
```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json

{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

### 6. Reconciliação Contábil da Carteira
```http
POST /wallets/:walletId/reconciliation
```
Retorna auditoria comparando o saldo materializado com a soma histórica de créditos e débitos do ledger.

---

## 📖 Arquitetura e Decisões Técnicas

Para detalhes aprofundados sobre **Domain-Driven Design**, **escolha do MikroORM**, **estratégia de locks pessimistas**, **hashing canônico SHA-256**, **Transactional Outbox** e **integração com IdP externo (Keycloak/Zitadel)**, consulte o documento:

👉 **[ARCHITECTURE.md](./ARCHITECTURE.md)**

