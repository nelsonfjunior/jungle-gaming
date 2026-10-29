import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { GlobalHttpExceptionFilter } from "../../src/interfaces/http/filters/http-exception.filter";

describe("HTTP REST API Endpoints (E2E Integration)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test"; // Evita que os workers de background concorram no teste HTTP

    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalHttpExceptionFilter());

    await app.listen(0); // Porta aleatória para evitar conflito
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === "string" ? address : address.port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("should check GET /health/live and GET /health/ready", async () => {
    const liveRes = await fetch(`${baseUrl}/health/live`);
    expect(liveRes.status).toBe(200);
    const liveData = await liveRes.json();
    expect(liveData.status).toBe("ok");

    const readyRes = await fetch(`${baseUrl}/health/ready`);
    expect(readyRes.status).toBe(200);
    const readyData = await readyRes.json();
    expect(readyData.status).toBe("ready");
    expect(readyData.services.database).toBe("connected");
    expect(readyData.services.sqs).toBe("connected");
  });

  it("should create wallet via POST /wallets and get via GET /wallets/:id", async () => {
    const playerId = uuidv4();
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "500.00", currency: "BRL" },
      }),
    });

    expect(createRes.status).toBe(201);
    const createdWallet = await createRes.json();
    expect(createdWallet.id).toBeDefined();
    expect(createdWallet.playerId).toBe(playerId);
    expect(createdWallet.balance.amount).toBe("500.00");

    const getRes = await fetch(`${baseUrl}/wallets/${createdWallet.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(createdWallet.id);
    expect(fetched.balance.amount).toBe("500.00");
  });

  it("should reject duplicate wallet creation with 409 Conflict", async () => {
    const playerId = uuidv4();
    await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });

    const dupRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });

    expect(dupRes.status).toBe(409);
  });

  it("should require Idempotency-Key header on POST /wagering/transactions", async () => {
    const res = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "prov-1",
        externalTransactionId: "tx-1",
        playerId: uuidv4(),
        walletId: uuidv4(),
        roundId: "r-1",
        gameId: "g-1",
        kind: "BET",
        money: { amount: "10.00", currency: "BRL" },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should process BET via POST /wagering/transactions and support idempotent replay", async () => {
    const playerId = uuidv4();
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });
    const wallet = await walletRes.json();

    const idempotencyKey = `http-idemp-${uuidv4()}`;
    const externalTxId = `http-tx-${uuidv4()}`;

    const payload = {
      providerId: "prov-evolution",
      externalTransactionId: externalTxId,
      playerId,
      walletId: wallet.id,
      roundId: "round-http-1",
      gameId: "roulette",
      kind: "BET",
      money: { amount: "30.00", currency: "BRL" },
    };

    // 1ª Chamada: Processa com sucesso
    const call1 = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    expect(call1.status).toBe(200);
    const data1 = await call1.json();
    expect(data1.status).toBe("PROCESSED");
    expect(data1.balance.amount).toBe("70.00");
    expect(data1.idempotentReplay).toBe(false);

    // 2ª Chamada: Idempotent Replay
    const call2 = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    expect(call2.status).toBe(200);
    const data2 = await call2.json();
    expect(data2.transactionId).toBe(data1.transactionId);
    expect(data2.idempotentReplay).toBe(true);
    expect(data2.balance.amount).toBe("70.00");

    // 3ª Chamada: Mesma chave com payload divergente -> 409 Conflict
    const callConflict = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        ...payload,
        money: { amount: "35.00", currency: "BRL" }, // Modificado
      }),
    });

    expect(callConflict.status).toBe(409);
  });

  it("should return 422 Unprocessable Entity when BET has insufficient funds", async () => {
    const playerId = uuidv4();
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "50.00", currency: "BRL" },
      }),
    });
    const wallet = await walletRes.json();

    const res = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `idemp-reject-${uuidv4()}`,
      },
      body: JSON.stringify({
        providerId: "prov-evolution",
        externalTransactionId: `tx-reject-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-http-2",
        gameId: "roulette",
        kind: "BET",
        money: { amount: "100.00", currency: "BRL" }, // Mais do que o saldo
      }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.status).toBe("REJECTED");
    expect(data.failureCode).toBe("INSUFFICIENT_FUNDS");
  });

  it("should paginate ledger via GET /wallets/:id/ledger and reconcile via POST /wallets/:id/reconciliation", async () => {
    const playerId = uuidv4();
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "200.00", currency: "BRL" },
      }),
    });
    const wallet = await walletRes.json();

    // Faz 2 apostas
    for (let i = 1; i <= 2; i++) {
      await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `idemp-ledger-${i}-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "prov-evolution",
          externalTransactionId: `tx-ledger-${i}-${uuidv4()}`,
          playerId,
          walletId: wallet.id,
          roundId: `round-${i}`,
          gameId: "slots",
          kind: "BET",
          money: { amount: "20.00", currency: "BRL" },
        }),
      });
    }

    // Consulta ledger com limit 2
    const ledgerRes = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=2`);
    expect(ledgerRes.status).toBe(200);
    const ledgerData = await ledgerRes.json();
    expect(ledgerData.items).toHaveLength(2);
    expect(ledgerData.hasMore).toBe(true);
    expect(ledgerData.nextCursor).toBeDefined();

    // Consulta próxima página usando o cursor
    const page2Res = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(
        ledgerData.nextCursor,
      )}`,
    );
    expect(page2Res.status).toBe(200);
    const page2Data = await page2Res.json();
    expect(page2Data.items).toHaveLength(1); // 1 de opening restante
    expect(page2Data.hasMore).toBe(false);

    // Reconciliação contábil: Saldo deve bater 160.00 (200 - 20 - 20)
    const reconRes = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: "POST",
    });
    expect(reconRes.status).toBe(200);
    const reconData = await reconRes.json();
    expect(reconData.consistent).toBe(true);
    expect(reconData.storedBalance.amount).toBe("160.00");
    expect(reconData.calculatedBalance.amount).toBe("160.00");
    expect(reconData.difference.amount).toBe("0.00");
    expect(reconData.checkedEntries).toBe(3); // 1 opening + 2 bets
  });
});
