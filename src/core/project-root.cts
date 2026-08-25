/** Bounded, read-only nearest-project discovery for advisory Hook bootstraps. */

export type ProjectHookHost = "codex" | "claude";

export interface ProjectHookDiscoveryOptions {
  readonly cwd: string;
  readonly host: ProjectHookHost;
  readonly stateRelativePath: string;
  readonly launcherRelativePath: string;
  readonly maxAncestors?: number;
}

export interface ProjectHookResolution {
  readonly projectRoot: string;
  readonly launcherPath: string;
}

export interface ProjectHookCommands {
  readonly command: string;
  readonly commandWindows: string;
}

/**
 * Keep this function self-contained: its compiled source is embedded in the fixed
 * host command so discovery can run before any project-relative module is known.
 */
function findNearestProjectHookRuntime(
  options: ProjectHookDiscoveryOptions,
): ProjectHookResolution | undefined {
  try {
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const maximumStateBytes = 1024 * 1024;
    const maximumLauncherBytes = 1024 * 1024;
    const maximumManagedPaths = 1024;
    const defaultAncestorLimit = 256;
    const digestPattern = /^[0-9a-f]{64}$/;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const isSafeRelativePath = (value: unknown): value is string => {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\\") ||
        path.posix.isAbsolute(value) ||
        path.win32.isAbsolute(value)
      ) {
        return false;
      }
      const parts = value.split("/");
      return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
    };
    const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
      Object.keys(value).sort().join("\0") === [...allowed].sort().join("\0");
    const validateOriginal = (value: unknown): boolean => {
      if (!isRecord(value) || (value.kind !== "absent" && value.kind !== "base64")) return false;
      if (value.kind === "absent") return exactKeys(value, ["kind"]);
      if (!exactKeys(value, ["data", "kind"]) || typeof value.data !== "string") return false;
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) {
        return false;
      }
      return Buffer.from(value.data, "base64").toString("base64") === value.data;
    };
    const validateSection = (value: unknown): boolean => {
      if (!isRecord(value)) return false;
      const keys = Object.keys(value).sort().join("\0");
      if (keys !== "digest\0fileExisted\0id" && keys !== "createdContainers\0digest\0fileExisted\0id") {
        return false;
      }
      return typeof value.id === "string" &&
        value.id.length > 0 &&
        value.id.length <= 160 &&
        /^[A-Za-z0-9_.:-]+$/.test(value.id) &&
        typeof value.digest === "string" &&
        digestPattern.test(value.digest) &&
        typeof value.fileExisted === "boolean" &&
        (value.createdContainers === undefined || (
          Array.isArray(value.createdContainers) &&
          value.createdContainers.length <= 8 &&
          new Set(value.createdContainers).size === value.createdContainers.length &&
          value.createdContainers.every((item) =>
            typeof item === "string" && /^[A-Za-z0-9_.:-]+$/.test(item))
        ));
    };
    const validateContainedFile = (root: string, relativePath: string): string | undefined => {
      let current = root;
      const parts = relativePath.split("/");
      for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        let metadata: import("node:fs").Stats;
        try {
          metadata = fs.lstatSync(current);
        } catch {
          return undefined;
        }
        if (metadata.isSymbolicLink()) return undefined;
        const destination = index === parts.length - 1;
        if ((destination && !metadata.isFile()) || (!destination && !metadata.isDirectory())) {
          return undefined;
        }
      }
      const relation = path.relative(root, current);
      if (relation.length === 0 || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
        return undefined;
      }
      return current;
    };
    const parseCurrentState = (
      bytes: Buffer,
      host: ProjectHookHost,
      stateRelativePath: string,
      launcherRelativePath: string,
    ): { readonly launcherDigest: string } | undefined => {
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        return undefined;
      }
      if (!isRecord(value)) return undefined;
      const keys = Object.keys(value).sort().join("\0");
      if (
        keys !== "digests\0environment\0host\0managedFiles\0originals\0packageVersion\0schemaVersion" &&
        keys !== "digests\0environment\0host\0managedFiles\0originals\0packageVersion\0schemaVersion\0sections"
      ) {
        return undefined;
      }
      if (
        value.schemaVersion !== 1 ||
        value.host !== host ||
        value.environment !== "qa" ||
        typeof value.packageVersion !== "string" ||
        value.packageVersion.length === 0 ||
        value.packageVersion.length > 128 ||
        !Array.isArray(value.managedFiles) ||
        value.managedFiles.length === 0 ||
        value.managedFiles.length > maximumManagedPaths ||
        !value.managedFiles.every(isSafeRelativePath) ||
        new Set(value.managedFiles).size !== value.managedFiles.length ||
        !value.managedFiles.includes(stateRelativePath) ||
        !value.managedFiles.includes(launcherRelativePath) ||
        !isRecord(value.originals) ||
        !isRecord(value.digests) ||
        (value.sections !== undefined && !isRecord(value.sections))
      ) {
        return undefined;
      }
      const managed = new Set(value.managedFiles as string[]);
      if (Object.entries(value.originals).some(([key, original]) =>
        !managed.has(key) || !validateOriginal(original))) {
        return undefined;
      }
      if (Object.entries(value.digests).some(([key, digest]) =>
        !managed.has(key) || typeof digest !== "string" || !digestPattern.test(digest))) {
        return undefined;
      }
      if (value.sections !== undefined && Object.entries(value.sections).some(([key, section]) =>
        !managed.has(key) || !validateSection(section))) {
        return undefined;
      }
      const launcherDigest = value.digests[launcherRelativePath];
      return typeof launcherDigest === "string" && digestPattern.test(launcherDigest)
        ? { launcherDigest }
        : undefined;
    };

    if (
      (options.host !== "codex" && options.host !== "claude") ||
      !isSafeRelativePath(options.stateRelativePath) ||
      !isSafeRelativePath(options.launcherRelativePath)
    ) {
      return undefined;
    }
    const ancestorLimit = options.maxAncestors ?? defaultAncestorLimit;
    if (!Number.isInteger(ancestorLimit) || ancestorLimit < 1 || ancestorLimit > defaultAncestorLimit) {
      return undefined;
    }

    let current = path.resolve(options.cwd);
    for (let visited = 0; visited < ancestorLimit; visited += 1) {
      const stateCandidate = path.join(current, ...options.stateRelativePath.split("/"));
      let stateMetadata: import("node:fs").Stats;
      try {
        stateMetadata = fs.lstatSync(stateCandidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
        continue;
      }

      // Existence establishes a non-skippable boundary before any validation.
      if (!stateMetadata.isFile() || stateMetadata.isSymbolicLink() || stateMetadata.size > maximumStateBytes) {
        return undefined;
      }
      const statePath = validateContainedFile(current, options.stateRelativePath);
      if (statePath === undefined) return undefined;
      let stateBytes: Buffer;
      try {
        stateBytes = fs.readFileSync(statePath);
      } catch {
        return undefined;
      }
      if (stateBytes.length > maximumStateBytes) return undefined;
      const state = parseCurrentState(
        stateBytes,
        options.host,
        options.stateRelativePath,
        options.launcherRelativePath,
      );
      if (state === undefined) return undefined;

      const launcherPath = validateContainedFile(current, options.launcherRelativePath);
      if (launcherPath === undefined) return undefined;
      let launcherBytes: Buffer;
      try {
        const metadata = fs.lstatSync(launcherPath);
        if (metadata.size > maximumLauncherBytes) return undefined;
        launcherBytes = fs.readFileSync(launcherPath);
      } catch {
        return undefined;
      }
      if (
        launcherBytes.length > maximumLauncherBytes ||
        crypto.createHash("sha256").update(launcherBytes).digest("hex") !== state.launcherDigest
      ) {
        return undefined;
      }
      return Object.freeze({ projectRoot: current, launcherPath });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Resolve the nearest selected-host launcher without crossing an invalid inner boundary. */
export function findNearestProjectHook(
  options: ProjectHookDiscoveryOptions,
): ProjectHookResolution | undefined {
  return findNearestProjectHookRuntime(options);
}

function bootstrapSource(): string {
  // This fixed program stays below cmd.exe's command-line limit. The exported
  // function above is the readable contract; exact rendered-command tests keep
  // this compact boundary behaviorally aligned with it.
  return "const f=require('node:fs'),p=require('node:path'),h=require('node:crypto'),c=require('node:child_process'),H=process.argv[2],S=process.argv[3],L=process.argv[4],W=process.argv[5]==='windows',D=/^[0-9a-f]{64}$/,O=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),E=(x,a)=>Object.keys(x).sort().join('\\0')===a,V=x=>typeof x==='string'&&x.length>0&&!x.includes('\\\\')&&!p.posix.isAbsolute(x)&&!p.win32.isAbsolute(x)&&x.split('/').every(y=>y&&y!=='.'&&y!=='..'),R=x=>O(x)&&(x.kind==='absent'?E(x,'kind'):x.kind==='base64'&&E(x,'data\\0kind')&&typeof x.data==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x.data)&&Buffer.from(x.data,'base64').toString('base64')===x.data),T=x=>{if(!O(x))return false;const k=Object.keys(x).sort().join('\\0');return(k==='digest\\0fileExisted\\0id'||k==='createdContainers\\0digest\\0fileExisted\\0id')&&typeof x.id==='string'&&x.id.length>0&&x.id.length<=160&&/^[A-Za-z0-9_.:-]+$/.test(x.id)&&typeof x.digest==='string'&&D.test(x.digest)&&typeof x.fileExisted==='boolean'&&(x.createdContainers===undefined||(Array.isArray(x.createdContainers)&&x.createdContainers.length<=8&&new Set(x.createdContainers).size===x.createdContainers.length&&x.createdContainers.every(y=>typeof y==='string'&&/^[A-Za-z0-9_.:-]+$/.test(y))))};try{let d=p.resolve(process.cwd());for(let n=0;n<256;n++){const q=p.join(d,...S.split('/'));let m;try{m=f.lstatSync(q)}catch(e){if(e.code!=='ENOENT')break;const a=p.dirname(d);if(a===d)break;d=a;continue}if(m.isSymbolicLink()||!m.isFile()||m.size>1048576)break;const F=r=>{let x=d,z=r.split('/');for(let i=0;i<z.length;i++){x=p.join(x,z[i]);const t=f.lstatSync(x);if(t.isSymbolicLink()||(i<z.length-1?!t.isDirectory():!t.isFile()))return}return x},s=F(S);if(!s)break;const b=f.readFileSync(s);if(b.length>1048576)break;const j=JSON.parse(b.toString('utf8')),k=Object.keys(j).sort().join('\\0'),k1='digests\\0environment\\0host\\0managedFiles\\0originals\\0packageVersion\\0schemaVersion',k2=k1+'\\0sections';if((k!==k1&&k!==k2)||j.schemaVersion!==1||j.host!==H||j.environment!=='qa'||typeof j.packageVersion!=='string'||!j.packageVersion||!Array.isArray(j.managedFiles)||j.managedFiles.length>1024||!j.managedFiles.every(V)||new Set(j.managedFiles).size!==j.managedFiles.length||!j.managedFiles.includes(S)||!j.managedFiles.includes(L)||!O(j.originals)||!O(j.digests)||(j.sections!==undefined&&!O(j.sections)))break;const M=new Set(j.managedFiles);if(Object.entries(j.originals).some(([a,v])=>!M.has(a)||!R(v))||Object.entries(j.digests).some(([a,v])=>!M.has(a)||typeof v!=='string'||!D.test(v))||(j.sections!==undefined&&Object.entries(j.sections).some(([a,v])=>!M.has(a)||!T(v)))||!D.test(j.digests[L]))break;const x=F(L);if(!x)break;const z=f.readFileSync(x);if(z.length>1048576||h.createHash('sha256').update(z).digest('hex')!==j.digests[L])break;const e=W?(process.env.ComSpec||process.env.COMSPEC||'cmd.exe'):'sh',a=W?['/d','/c','call',x]:[x],r=c.spawnSync(e,a,{stdio:['inherit','pipe','pipe'],timeout:5000,windowsHide:true});if(!r.error&&r.status===0&&Buffer.isBuffer(r.stdout))process.stdout.write(r.stdout);break}}catch{}";
}

function encodedBootstrap(): string {
  return Buffer.from(bootstrapSource(), "utf8").toString("base64");
}

function hostPaths(host: ProjectHookHost): {
  readonly state: string;
  readonly posixLauncher: string;
  readonly windowsLauncher: string;
} {
  const root = host === "codex" ? ".codex" : ".claude";
  return Object.freeze({
    state: `${root}/kcoderag-nav/install-state.json`,
    posixLauncher: `${root}/kcoderag-nav/qa/hooks/run_hook.sh`,
    windowsLauncher: `${root}/kcoderag-nav/qa/hooks/run_hook.cmd`,
  });
}

/** Render fixed shell commands whose only variable input is the current session cwd. */
export function renderProjectHookCommands(host: ProjectHookHost): ProjectHookCommands {
  const paths = hostPaths(host);
  const encoded = encodedBootstrap();
  const decoderWindows = "Function('require','process',Buffer.from(process.argv[1],'base64').toString('utf8'))(require,process)";
  const decoderPosix = "Function(\"require\",\"process\",Buffer.from(process.argv[1],\"base64\").toString(\"utf8\"))(require,process)";
  return Object.freeze({
    command: `node -e '${decoderPosix}' ${encoded} ${host} ${paths.state} ${paths.posixLauncher} posix 2>/dev/null || :`,
    commandWindows: `node -e "${decoderWindows}" ${encoded} ${host} ${paths.state} ${paths.windowsLauncher} windows 2>nul & exit /b 0`,
  });
}
