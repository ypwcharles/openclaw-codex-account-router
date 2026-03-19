import { Command } from "commander";
import { registerAccountCommand } from "./commands/account.js";
import { registerAccountsCommands } from "./commands/accounts.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRepairCommand } from "./commands/repair.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();
program.name("openclaw-router");

registerSetupCommand(program);
registerStatusCommand(program);
registerRunCommand(program);
registerDoctorCommand(program);
registerRepairCommand(program);
registerAccountCommand(program);
registerAccountsCommands(program, { hidden: true });

await program.parseAsync(process.argv);
