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
          const desc = docs.find((what: any) => what.kind === "description")
            ?.value;
            
          const example = docs.find((what: any) => what.kind === "example")
            ?.value;

          let eg;
          if (example)
          {
            const parts = example.split(/```/);
            const backticks = '```';
            eg = `@example ${parts[0]}\n${backticks}${parts[1]}${backticks}`;
          }
          
          const paramDocs =
            docs
              .filter((what: any) => what.kind === "param")
              .map((what: any) => {
                return ` * @param {${what.value.type}} ${what.value.name} - ${
                  what.value.description || ""
                }`;
              })
              .join("\n") || " *";

          const params = sig
            .getParameters()
            .map((param: any) => {
              const serialized = param.serialize();
              
              switch (!!param.isNamed()) {
                case true:
                  const tmp = param
                    .getNamedElements()
                    .map((p) => {
                      const defaultVal =
                        p.default != null ? " = " + p.default : "";

                      return `${p.name}${defaultVal}`;
                    })
                    .join("; ");
                  return `{${tmp}}: ${serialized.type.text}`;
                case false:
                  return `${serialized.name}: ${serialized.type.text}`;
              }
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
${paramDocs}
 *
 * ${eg || ''}
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
  return transform(parsed?.result || []);
};
