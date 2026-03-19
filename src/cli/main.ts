import { Command } from "commander";

const program = new Command();
program.name("codex-account-router");

program.command("status").description("Show router status");
program.command("run").description("Run OpenClaw with Codex account routing");

await program.parseAsync(process.argv);
