// hard-code platform files for esbuild code-splitting

export function importPlatform(name: string) : Promise<any> {
    switch (name) {
      case "zx": return import("../platform/zx");
      default: throw new Error(`Platform not recognized: '${name}'`)
    }
  }

