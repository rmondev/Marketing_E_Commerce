// Read a line from stdin without echoing the typed characters. Uses raw
// mode directly rather than readline's internal hooks (not accessible on
// the promises-based Interface in Node 22). Caller must ensure no readline
// Interface is actively consuming stdin when this runs.
//
// Key codes (numeric to survive editors that strip non-printable bytes from
// string literals): 3 = ETX/Ctrl-C, 8 = BS, 10 = LF, 13 = CR, 127 = DEL.
export function askMasked(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buffer = "";

    const finish = (value: string | null): void => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write("\n");
      if (value === null) process.exit(130); // Ctrl-C
      resolve(value);
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) return finish(buffer);
        if (code === 3) return finish(null);
        if (code === 8 || code === 127) {
          if (buffer.length > 0) buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };

    stdin.on("data", onData);
  });
}

// Display helper: never log full tokens.
export function maskToken(token: string): string {
  if (token.length <= 16) return "********";
  return `${token.slice(0, 8)}...${token.slice(-4)} (${token.length} chars)`;
}
