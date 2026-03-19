import { Command } from "commander";
import { registerAccountsCommands } from "./commands/accounts.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRunCommand } from "./commands/run.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();
program.name("codex-account-router");

registerStatusCommand(program);
registerRunCommand(program);
registerDoctorCommand(program);
registerAccountsCommands(program);

await program.parseAsync(process.argv);
