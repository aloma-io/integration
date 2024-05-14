import { parseFromFiles } from "@ts-ast-parser/core";

const transform = (meta: any) => {
  if (!meta?.length) throw new Error("metadata is empty");
  meta = meta[0];

  if (meta.getDeclarations()?.length !== 1) {
    throw new Error("connector file needs to export default class");
  }

  const methods = {};
  const decl = meta.getDeclarations()[0];

  const members = decl.getMethods().filter((member: any) => {
    return !(
      member.isStatic() ||
      member.isInherited() ||
      member.getKind() !== "Method" ||
      member.getModifier() !== "public" ||
      member.getName().startsWith("_")
    );
  });

  const text = members
    .map((member: any) => {
      methods[member.getName()] = true;

      return member
        .getSignatures()
        .map((sig: any) => {
          const docs = sig.getJSDoc().serialize() || [];
          const desc = docs.find(
            (what: any) => what.kind === "description",
          )?.value;

          const example = docs.find(
            (what: any) => what.kind === "example",
          )?.value;
          
          const ns = docs.find((what: any) => what.kind === 'namespace')?.value;
          let space = ns?`@namespace ${ns}`:''

          let eg;
          if (example) {
            const parts = example.split(/```/);
            const backticks = "```";
            eg = `@example ${parts[0] || "usage"}\n${backticks}${
              parts[1]
            }${backticks}`;
          }

          const paramDocs = docs.filter((what: any) => what.kind === "param");

          const params = sig
            .getParameters()
            .filter((param) => param.isNamed())
            .map((param: any) => {
              const serialized = param.serialize();

              const prefix = param
                .getNamedElements()
                .map((p) => {
                  const defaultVal =
                    p.getDefault() != null ? " = " + p.getDefault() : "";

                  return `${p.getName()}${defaultVal}`;
                })
                .join("; ");

              const suffix = serialized.type.properties
                .map((p) => {
                  const comment = paramDocs.find(
                    (what) => what.value.name === p.name,
                  );
                  const desc = (comment?.value.description || "").replace(
                    /\\@/gi,
                    "@",
                  );

                  return `\n/**\n${desc}\n */\n ${p.name}: ${p.type.text}`;
                })
                .join("; ");

              return `{${prefix}}: {${suffix}}`;
            })
            .join(", ");

          const retVal = sig
            .serialize()
            .return.type.text.replace(/^Promise</, "")
            .replace(/>$/, "");

          return `
/**
 * ${desc || ""}
 *
 * ${space || ''}
 * ${eg || ""}
 **/    
declare function ${member.getName()}(${params}): ${retVal};
      `;
        })
        .join("\n");
    })
    .join("");

  return { text, methods: Object.keys(methods) };
};

export default async (path: string) => {
  const parsed = await parseFromFiles([path]);
  if (parsed.errors?.length)
    throw new Error(path + " " + JSON.stringify(parsed.errors));
  return transform(parsed.project?.getModules() || []);
};
