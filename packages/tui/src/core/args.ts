export type CliArgs = { workspace?: string; page?: string; snapshot: boolean; width: number; height: number; framework?: string };

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { snapshot: false, width: 160, height: 45 };
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot") out.snapshot = true;
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--page") out.page = argv[++i];
    else if (a === "--framework") out.framework = argv[++i];
    else if (a === "--width") out.width = num(argv[++i], 160);
    else if (a === "--height") out.height = num(argv[++i], 45);
  }
  return out;
}
