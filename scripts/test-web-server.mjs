import { spawn } from "node:child_process";

// Playwright가 관리하는 서버의 자식도 Windows 콘솔을 표시하지 않는다.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", process.argv[2]], {
  env: process.env, stdio: "inherit", windowsHide: true,
});
server.once("error", (error) => { console.error(error); process.exitCode = 1; });
server.once("exit", (code) => { process.exit(code ?? 1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.kill(signal));
