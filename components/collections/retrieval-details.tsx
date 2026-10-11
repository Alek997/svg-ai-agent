"use client";
import type { Retrieval } from "@/lib/collections/contracts";
import { SvgImage } from "./svg-image";
export function RetrievalDetails({ detail }: { detail: Retrieval }) {
  return (
    <div className="space-y-3 text-xs text-stone-600">
      <p>
        <strong>{detail.collectionName}</strong> · Query: {detail.query}
      </p>
      <div className="overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Candidate / description</th>
              <th>Cosine</th>
              <th>Semantic rank</th>
              <th>Keyword rank</th>
              <th>RRF / rank</th>
            </tr>
          </thead>
          <tbody>
            {detail.candidates.map((row) => (
              <tr key={row.id} className="border-t border-stone-200">
                <td className="p-2">
                  {row.filename}
                  <br />
                  {row.description}
                </td>
                <td>{row.semanticScore?.toFixed(4) ?? "—"}</td>
                <td>{row.semanticRank ?? "—"}</td>
                <td>{row.keywordRank ?? "—"}</td>
                <td>
                  {row.fusedScore.toFixed(5)} / {row.fusedRank}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!detail.candidates.length && <p>No searchable references.</p>}
      <p>Selected references (up to three complete SVGs):</p>
      <div className="flex flex-wrap gap-3">
        {detail.references.map((ref) => (
          <div key={ref.id}>
            {ref.deleted ? (
              <p>Reference deleted</p>
            ) : ref.source ? (
              <>
                <SvgImage
                  source={ref.source}
                  label={
                    detail.candidates.find((c) => c.id === ref.iconId)
                      ?.filename ?? "Reference"
                  }
                />
                <details>
                  <summary>Source · {ref.hash.slice(0, 10)}</summary>
                  <pre className="max-h-40 max-w-sm overflow-auto whitespace-pre-wrap">
                    {ref.source}
                  </pre>
                </details>
              </>
            ) : (
              <p>Reference source unavailable</p>
            )}
          </div>
        ))}
      </div>
      {detail.conventions.map((value) => (
        <p key={value}>{value}</p>
      ))}
    </div>
  );
}
