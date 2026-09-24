// LanceDB currently accepts filter expressions as strings, so quote the value
// as a string literal before inserting it into the expression.
export function startUrlFilter(startUrl: string): string {
  return `starturl = '${startUrl.replaceAll("'", "''")}'`;
}
