import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  dbName: process.env.DB_NAME || "wagering_db",
  entities: ["./dist/infrastructure/database/entities/*.entity.js"],
  entitiesTs: ["./src/infrastructure/database/entities/*.entity.ts"],
  extensions: [Migrator],
  migrations: {
    path: "./dist/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
    transactional: true,
    allOrNothing: true,
    dropTables: false,
    safe: true,
    emit: "ts",
  },
  debug: process.env.NODE_ENV === "development",
});
