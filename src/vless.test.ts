import { describe, expect, it } from "vitest";
import { parseVlessUrl } from "./vless.js";

describe("parseVlessUrl", () => {
  it("parses a valid vless URL", () => {
    const profile = parseVlessUrl(
      "vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&type=tcp&sni=google.com#MyNode"
    );

    expect(profile.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(profile.host).toBe("example.com");
    expect(profile.port).toBe(443);
    expect(profile.security).toBe("reality");
    expect(profile.type).toBe("tcp");
    expect(profile.sni).toBe("google.com");
    expect(profile.remark).toBe("MyNode");
  });

  it("throws for non-vless URL", () => {
    expect(() => parseVlessUrl("https://example.com")).toThrow("Unsupported scheme");
  });

  it("throws for invalid port", () => {
    expect(() => parseVlessUrl("vless://id@example.com:0?type=tcp")).toThrow("Invalid port");
  });
});
