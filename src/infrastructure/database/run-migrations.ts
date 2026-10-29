import { MikroORM } from "@mikro-orm/postgresql";
import config from "./mikro-orm.config";

async function run() {
  console.log("Initializing MikroORM for migrations...");
  const orm = await MikroORM.init(config);

  try {
    const migrator = orm.migrator;
    console.log("Running pending migrations...");
    await migrator.up();
    console.log("Migrations applied successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await orm.close(true);
  }
}

run();

