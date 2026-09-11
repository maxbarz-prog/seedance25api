import type { HelpBlock } from "@/lib/help";

// The article renderer. Deliberately a handful of block types rather than
// markdown: the content is generated from the product registry, so it is
// structured data already, and a table of live prices cannot be expressed as
// a string that stays correct.
export default function HelpBody({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "p") return <p key={i}>{b.text}</p>;
        if (b.kind === "note") {
          return (
            <p
              key={i}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted"
            >
              {b.text}
            </p>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items?.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  {b.head?.map((h, j) => (
                    <th key={j} className="p-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows?.map((r, j) => (
                  <tr key={j} className="border-b border-line last:border-0">
                    {r.map((c, k) => (
                      <td key={k} className={`p-3 ${k === 0 ? "font-medium" : "tabular-nums"}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
