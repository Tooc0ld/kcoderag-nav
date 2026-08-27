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

export type ProjectHookLauncher = "advisory" | "mcp-call-marker";

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
    const capabilityOrder = Object.freeze(["kcoderag-navigation", "code-style-nudge"] as const);
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
    const validateContributors = (value: unknown): value is string[] => {
      if (!Array.isArray(value) || value.length === 0 || !value.every((item) => capabilityOrder.includes(item))) {
        return false;
      }
      const canonical = capabilityOrder.filter((id) => value.includes(id));
      return canonical.length === value.length && canonical.every((id, index) => value[index] === id);
    };
    const sortedUnique = (value: unknown, validate: (item: string) => boolean): value is string[] =>
      Array.isArray(value) &&
      value.every((item) => typeof item === "string" && validate(item)) &&
      value.every((item, index) => index === 0 || (value[index - 1] as string) < item);
    const validateSection = (value: unknown): value is Record<string, unknown> => {
      if (!isRecord(value)) return false;
      const keys = value.createdContainers === undefined
        ? ["contributors", "digest", "fileExisted", "id", "path"]
        : ["contributors", "createdContainers", "digest", "fileExisted", "id", "path"];
      if (!exactKeys(value, keys)) {
        return false;
      }
      return isSafeRelativePath(value.path) &&
        typeof value.id === "string" &&
        value.id.length > 0 &&
        value.id.length <= 160 &&
        /^[A-Za-z0-9_.:-]+$/.test(value.id) &&
        typeof value.digest === "string" &&
        digestPattern.test(value.digest) &&
        typeof value.fileExisted === "boolean" &&
        (value.createdContainers === undefined || (
          sortedUnique(value.createdContainers, (item) => /^[A-Za-z0-9_.:-]{1,160}$/.test(item))
        )) &&
        validateContributors(value.contributors);
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
    ): { readonly files: readonly { readonly path: string; readonly digest: string }[] } | undefined => {
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        return undefined;
      }
      if (!isRecord(value)) return undefined;
      if (!exactKeys(value, [
        "capabilities",
        "compositeDigest",
        "files",
        "host",
        "packageVersion",
        "schemaVersion",
        "sections",
      ])) {
        return undefined;
      }
      if (
        value.schemaVersion !== 1 ||
        value.host !== host ||
        typeof value.packageVersion !== "string" ||
        value.packageVersion.length === 0 ||
        value.packageVersion.length > 160 ||
        !Array.isArray(value.capabilities) ||
        value.capabilities.length === 0 ||
        value.capabilities.length > capabilityOrder.length ||
        !Array.isArray(value.files) ||
        value.files.length === 0 ||
        value.files.length > maximumManagedPaths ||
        !Array.isArray(value.sections) ||
        value.sections.length > maximumManagedPaths ||
        typeof value.compositeDigest !== "string" ||
        !digestPattern.test(value.compositeDigest)
      ) {
        return undefined;
      }

      const capabilities = value.capabilities as unknown[];
      const capabilityIds: string[] = [];
      const capabilityFiles = new Map<string, readonly string[]>();
      const capabilitySections = new Map<string, readonly string[]>();
      for (const raw of capabilities) {
        if (
          !isRecord(raw) ||
          !exactKeys(raw, ["files", "id", "sections"]) ||
          typeof raw.id !== "string" ||
          !capabilityOrder.some((id) => id === raw.id) ||
          !sortedUnique(raw.files, isSafeRelativePath) ||
          !sortedUnique(raw.sections, (item) => {
            const separator = item.lastIndexOf("#");
            return separator > 0 &&
              isSafeRelativePath(item.slice(0, separator)) &&
              /^[A-Za-z0-9_.:-]{1,160}$/.test(item.slice(separator + 1));
          })
        ) {
          return undefined;
        }
        capabilityIds.push(raw.id);
        capabilityFiles.set(raw.id, raw.files);
        capabilitySections.set(raw.id, raw.sections);
      }
      const canonicalIds = capabilityOrder.filter((id) => capabilityIds.includes(id));
      if (canonicalIds.length !== capabilityIds.length || !canonicalIds.every((id, index) => capabilityIds[index] === id)) {
        return undefined;
      }

      const files = (value.files as unknown[]).map((raw) => {
        if (
          !isRecord(raw) ||
          !exactKeys(raw, ["contributors", "digest", "original", "path"]) ||
          !isSafeRelativePath(raw.path) ||
          typeof raw.digest !== "string" ||
          !digestPattern.test(raw.digest) ||
          !validateOriginal(raw.original) ||
          !validateContributors(raw.contributors) ||
          raw.contributors.some((id) => !capabilityIds.includes(id))
        ) {
          return undefined;
        }
        return { path: raw.path, digest: raw.digest, contributors: raw.contributors };
      });
      if (
        files.some((file) => file === undefined) ||
        files.some((file, index) => index > 0 && (files[index - 1]?.path ?? "") >= (file?.path ?? ""))
      ) {
        return undefined;
      }
      const validFiles = files as { readonly path: string; readonly digest: string; readonly contributors: readonly string[] }[];
      const filesByPath = new Map(validFiles.map((file) => [file.path, file]));

      const sections = (value.sections as unknown[]).map((raw) => {
        if (!validateSection(raw) || (raw.contributors as string[]).some((id) => !capabilityIds.includes(id))) {
          return undefined;
        }
        const file = filesByPath.get(raw.path as string);
        if (file === undefined || (raw.contributors as string[]).some((id) => !file.contributors.includes(id))) {
          return undefined;
        }
        return {
          reference: `${raw.path as string}#${raw.id as string}`,
          contributors: raw.contributors as readonly string[],
        };
      });
      if (
        sections.some((section) => section === undefined) ||
        sections.some((section, index) => index > 0 &&
          (sections[index - 1]?.reference ?? "") >= (section?.reference ?? ""))
      ) {
        return undefined;
      }
      const validSections = sections as { readonly reference: string; readonly contributors: readonly string[] }[];
      const sectionsByReference = new Map(validSections.map((section) => [section.reference, section]));
      for (const id of capabilityIds) {
        const expectedFiles = validFiles.filter((file) => file.contributors.includes(id)).map((file) => file.path);
        const expectedSections = validSections
          .filter((section) => section.contributors.includes(id))
          .map((section) => section.reference);
        if (
          capabilityFiles.get(id)?.join("\0") !== expectedFiles.join("\0") ||
          capabilitySections.get(id)?.join("\0") !== expectedSections.join("\0") ||
          capabilityFiles.get(id)?.some((file) => !filesByPath.has(file)) ||
          capabilitySections.get(id)?.some((section) => !sectionsByReference.has(section))
        ) {
          return undefined;
        }
      }
      const composite = crypto.createHash("sha256").update(Buffer.from(JSON.stringify({
        schemaVersion: value.schemaVersion,
        packageVersion: value.packageVersion,
        host: value.host,
        capabilities: value.capabilities,
        files: value.files,
        sections: value.sections,
      }), "utf8")).digest("hex");
      if (composite !== value.compositeDigest || !filesByPath.has(launcherRelativePath)) {
        return undefined;
      }
      void stateRelativePath;
      return { files: validFiles.map((file) => ({ path: file.path, digest: file.digest })) };
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

      let launcherPath: string | undefined;
      for (const file of state.files) {
        const managedPath = validateContainedFile(current, file.path);
        if (managedPath === undefined) return undefined;
        let managedBytes: Buffer;
        try {
          const metadata = fs.lstatSync(managedPath);
          if (metadata.size > maximumLauncherBytes) return undefined;
          managedBytes = fs.readFileSync(managedPath);
        } catch {
          return undefined;
        }
        if (
          managedBytes.length > maximumLauncherBytes ||
          crypto.createHash("sha256").update(managedBytes).digest("hex") !== file.digest
        ) {
          return undefined;
        }
        if (file.path === options.launcherRelativePath) launcherPath = managedPath;
      }
      if (launcherPath === undefined) return undefined;
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

function compactBootstrapTemplate(): string {
  // This fixed program stays below cmd.exe's command-line limit. The exported
  // function above is the readable contract; exact rendered-command tests keep
  // this compact boundary behaviorally aligned with it.
  return "const f=require('node:fs'),p=require('node:path'),h=require('node:crypto'),c=require('node:child_process'),H=process.argv[2],S=process.argv[3],L=process.argv[4],W=process.argv[5]==='windows',A=['kcoderag-navigation','code-style-nudge'],D=/^[0-9a-f]{64}$/,O=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),E=(x,a)=>O(x)&&Object.keys(x).sort().join('\\0')===a,V=x=>typeof x==='string'&&x.length>0&&!x.includes('\\\\')&&!p.posix.isAbsolute(x)&&!p.win32.isAbsolute(x)&&x.split('/').every(y=>y&&y!=='.'&&y!=='..'),U=(x,v)=>Array.isArray(x)&&x.every((y,i)=>typeof y==='string'&&v(y)&&(!i||x[i-1]<y)),G=x=>Array.isArray(x)&&x.length>0&&A.filter(y=>x.includes(y)).join()===x.join(),R=x=>O(x)&&(x.kind==='absent'?E(x,'kind'):x.kind==='base64'&&E(x,'data\\0kind')&&typeof x.data==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x.data)&&Buffer.from(x.data,'base64').toString('base64')===x.data);try{let d=p.resolve(process.cwd());for(let n=0;n<256;n++){const q=p.join(d,...S.split('/'));let m;try{m=f.lstatSync(q)}catch(e){if(e.code!=='ENOENT')break;const a=p.dirname(d);if(a===d)break;d=a;continue}if(m.isSymbolicLink()||!m.isFile()||m.size>1048576)break;const F=r=>{let x=d,z=r.split('/');for(let i=0;i<z.length;i++){x=p.join(x,z[i]);const t=f.lstatSync(x);if(t.isSymbolicLink()||(i<z.length-1?!t.isDirectory():!t.isFile()))return}const a=p.relative(d,x);if(!a||a==='..'||a.startsWith('..'+p.sep)||p.isAbsolute(a))return;return x},s=F(S);if(!s)break;const b=f.readFileSync(s);if(b.length>1048576)break;const j=JSON.parse(b.toString('utf8'));if(!E(j,'capabilities\\0compositeDigest\\0files\\0host\\0packageVersion\\0schemaVersion\\0sections')||j.schemaVersion!==1||j.host!==H||typeof j.packageVersion!=='string'||!j.packageVersion||j.packageVersion.length>160||!Array.isArray(j.capabilities)||!j.capabilities.length||j.capabilities.length>A.length||!Array.isArray(j.files)||!j.files.length||j.files.length>1024||!Array.isArray(j.sections)||j.sections.length>1024||typeof j.compositeDigest!=='string'||!D.test(j.compositeDigest))break;const I=j.capabilities.map(x=>x.id),Z=x=>{const i=x.lastIndexOf('#');return i>0&&V(x.slice(0,i))&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x.slice(i+1))};if(A.filter(x=>I.includes(x)).join()!==I.join()||j.capabilities.some(x=>!E(x,'files\\0id\\0sections')||!I.includes(x.id)||!U(x.files,V)||!U(x.sections,Z))||j.files.some((x,i)=>!E(x,'contributors\\0digest\\0original\\0path')||!V(x.path)||!D.test(x.digest)||!R(x.original)||!G(x.contributors)||x.contributors.some(y=>!I.includes(y))||(i&&j.files[i-1].path>=x.path)))break;const M=new Map(j.files.map(x=>[x.path,x])),T=x=>{if(!O(x))return false;const k=x.createdContainers===undefined?'contributors\\0digest\\0fileExisted\\0id\\0path':'contributors\\0createdContainers\\0digest\\0fileExisted\\0id\\0path',g=M.get(x.path);return E(x,k)&&V(x.path)&&typeof x.id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x.id)&&D.test(x.digest)&&typeof x.fileExisted==='boolean'&&G(x.contributors)&&x.contributors.every(y=>I.includes(y)&&g&&g.contributors.includes(y))&&(x.createdContainers===undefined||U(x.createdContainers,y=>/^[A-Za-z0-9_.:-]{1,160}$/.test(y)))};if(j.sections.some((x,i)=>!T(x)||(i&&j.sections[i-1].path+'#'+j.sections[i-1].id>=x.path+'#'+x.id))||j.capabilities.some(x=>j.files.filter(y=>y.contributors.includes(x.id)).map(y=>y.path).join('\\0')!==x.files.join('\\0')||j.sections.filter(y=>y.contributors.includes(x.id)).map(y=>y.path+'#'+y.id).join('\\0')!==x.sections.join('\\0')))break;const v={schemaVersion:j.schemaVersion,packageVersion:j.packageVersion,host:j.host,capabilities:j.capabilities,files:j.files,sections:j.sections};if(h.createHash('sha256').update(Buffer.from(JSON.stringify(v),'utf8')).digest('hex')!==j.compositeDigest||!M.has(L))break;let x;for(const y of j.files){const z=F(y.path);if(!z)break;const t=f.lstatSync(z),u=f.readFileSync(z);if(t.size>1048576||u.length>1048576||h.createHash('sha256').update(u).digest('hex')!==y.digest)break;if(y.path===L)x=z}if(!x)break;const e=W?(process.env.ComSpec||process.env.COMSPEC||'cmd.exe'):'sh',a=W?['/d','/c','call',x,H]:[x,H],r=c.spawnSync(e,a,{stdio:['inherit','pipe','pipe'],timeout:5000,windowsHide:true});if(!r.error&&r.status===0&&Buffer.isBuffer(r.stdout))process.stdout.write(r.stdout);break}}catch{}";
}

function bootstrapSource(): string {
  return compactBootstrapTemplate().replace(
    "let x;for(const y of j.files){const z=F(y.path);if(!z)break;const t=f.lstatSync(z),u=f.readFileSync(z);if(t.size>1048576||u.length>1048576||h.createHash('sha256').update(u).digest('hex')!==y.digest)break;if(y.path===L)x=z}if(!x)break;",
    "let x,o=1;for(const y of j.files){const z=F(y.path);if(!z){o=0;break}const t=f.lstatSync(z),u=f.readFileSync(z);if(t.size>1048576||u.length>1048576||h.createHash('sha256').update(u).digest('hex')!==y.digest){o=0;break}if(y.path===L)x=z}if(!o||!x)break;",
  );
}

function encodedBootstrap(): string {
  return Buffer.from(bootstrapSource(), "utf8").toString("base64");
}

function hostPaths(host: ProjectHookHost, launcher: ProjectHookLauncher): {
  readonly state: string;
  readonly posixLauncher: string;
  readonly windowsLauncher: string;
} {
  const root = host === "codex" ? ".codex" : ".claude";
  const launcherName = launcher === "advisory" ? "run_hook" : "run_marker";
  return Object.freeze({
    state: `${root}/kcoderag-nav/install-state.json`,
    posixLauncher: `${root}/kcoderag-nav/qa/hooks/${launcherName}.sh`,
    windowsLauncher: `${root}/kcoderag-nav/qa/hooks/${launcherName}.cmd`,
  });
}

/** Render fixed shell commands whose only variable input is the current session cwd. */
export function renderProjectHookCommands(
  host: ProjectHookHost,
  launcher: ProjectHookLauncher = "advisory",
): ProjectHookCommands {
  const paths = hostPaths(host, launcher);
  const encoded = encodedBootstrap();
  const decoderWindows = "Function('require','process',Buffer.from(process.argv[1],'base64').toString('utf8'))(require,process)";
  const escapedDecoderWindows = decoderWindows.replaceAll("(", "^(").replaceAll(")", "^)");
  const decoderPosix = "Function(\"require\",\"process\",Buffer.from(process.argv[1],\"base64\").toString(\"utf8\"))(require,process)";
  return Object.freeze({
    command: `node -e '${decoderPosix}' ${encoded} ${host} ${paths.state} ${paths.posixLauncher} posix 2>/dev/null || :`,
    commandWindows: `cmd.exe /d /s /c "node -e ${escapedDecoderWindows} ${encoded} ${host} ${paths.state} ${paths.windowsLauncher} windows 2>nul & exit /b 0"`,
  });
}
