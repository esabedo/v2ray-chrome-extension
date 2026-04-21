const base = "http://127.0.0.1:8777";

async function call(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const vlessUrl =
  "vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&type=tcp&sni=google.com&fp=chrome&pbk=test&sid=abcd#Smoke";

async function run() {
  console.log(await call("/v1/health"));
  console.log(await call("/v1/profile", { method: "POST", body: JSON.stringify({ vlessUrl }) }));
  console.log(await call("/v1/connect", { method: "POST" }));
  console.log(await call("/v1/status"));
  console.log(await call("/v1/disconnect", { method: "POST" }));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
