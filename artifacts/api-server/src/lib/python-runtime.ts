import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

const pythonRoot = path.resolve(
  import.meta.dirname,
  "../../../telegram-phone-number-checker",
);
const bridgePath = path.resolve(
  import.meta.dirname,
  "../../../telegram-phone-number-checker/telegram_phone_number_checker/api_bridge.py",
);

export type TelegramPythonTool = "desktop-control" | "api-bridge";

export function telegramPythonInvocation(tool: TelegramPythonTool): {
  command: string;
  args: string[];
  cwd?: string;
} {
  const packagedEngine = process.env.TELEGRAM_ENGINE_EXE?.trim();
  if (packagedEngine) {
    return {
      command: packagedEngine,
      args: [tool],
      cwd: path.dirname(packagedEngine),
    };
  }

  const pythonBin = process.env.PYTHON_BIN?.trim() || "python";
  if (tool === "desktop-control") {
    return {
      command: pythonBin,
      args: ["-m", "telegram_phone_number_checker.desktop_control"],
      cwd: pythonRoot,
    };
  }

  return {
    command: pythonBin,
    args: [bridgePath],
    cwd: pythonRoot,
  };
}

export function spawnTelegramPython(
  tool: TelegramPythonTool,
  options: SpawnOptions,
) {
  const invocation = telegramPythonInvocation(tool);
  return spawn(invocation.command, invocation.args, {
    ...options,
    cwd: options.cwd ?? invocation.cwd,
    windowsHide: true,
  });
}
