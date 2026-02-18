import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class ArtifactStorage {
  constructor(
    public readonly homeDir: string,
    public readonly artifactsDir: string
  ) {}

  async ensure(): Promise<void> {
    await mkdir(this.homeDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });
  }

  async writeArtifact(
    runId: string,
    nodeId: string,
    type: "raw" | "merged" | "plan" | "log",
    content: string,
    extension: "json" | "md" | "txt" = "json"
  ): Promise<{ relativePath: string; bytes: number; sha256: string }> {
    const relativePath = join("artifacts", runId, `${nodeId}.${extension}`);
    const absolutePath = join(this.homeDir, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf-8");

    const bytes = Buffer.byteLength(content, "utf-8");
    const sha256 = createHash("sha256").update(content).digest("hex");

    // `type` is part of the function signature intentionally for schema clarity.
    void type;

    return { relativePath, bytes, sha256 };
  }

  async readArtifact(relativePath: string): Promise<string> {
    const absolutePath = join(this.homeDir, relativePath);
    const data = await readFile(absolutePath, "utf-8");
    return data;
  }
}
