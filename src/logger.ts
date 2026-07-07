type Meta = Record<string, unknown>;
function line(level: string, msg: string, meta?: Meta) {
  const base = `[${new Date().toISOString()}] ${level} ${msg}`;
  if (meta) console.log(base, JSON.stringify(meta));
  else console.log(base);
}
export const logger = {
  info: (m: string, meta?: Meta) => line('INFO', m, meta),
  warn: (m: string, meta?: Meta) => line('WARN', m, meta),
  error: (m: string, meta?: Meta) => line('ERROR', m, meta),
};
