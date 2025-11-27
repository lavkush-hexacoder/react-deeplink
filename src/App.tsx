import React, { useState, useCallback, useMemo } from "react";

// Types
interface Slot {
  type: "path_segment" | "query_param" | "fragment_param";
  name?: string;
  value: string;
  position?: number;
  segmentIndex?: number;
}

interface ParsedUrl {
  origin: string;
  host: string;
  scheme: string;
  pathSegments: Slot[];
  querySlots: Slot[];
  fragmentSlots: Slot[];
}

interface MappingRule {
  id: string;
  targetType: Slot["type"];
  name: string | null;
  position: number | null;
  segmentIndex: number | null;
  sourceVar: string;
  formatPattern: string;
  uppercase: boolean;
}

interface Template {
  exampleUrl: string;
  exampleParsed: ParsedUrl;
  mappingRules: MappingRule[];
}

const INTERNAL_VARIABLES = [
  { key: "checkIn", label: "checkIn (ISO date)", formatHint: "YYYY-MM-DD" },
  { key: "checkOut", label: "checkOut (ISO date)", formatHint: "YYYY-MM-DD" },
  { key: "adults", label: "adults (integer)" },
  { key: "children", label: "children (integer)" },
  {
    key: "totalGuests",
    label: "totalGuests (adults+children)",
    formatHint: "integer",
  },
  { key: "nights", label: "nights (auto if missing)" },
  { key: "promoCode", label: "promoCode (text)" },
  { key: "currency", label: "currency (ISO 4217)" },
  { key: "hotelId", label: "hotelId (text)" },
];

// Utility functions
function slotId(slot: Slot): string {
  if (slot.type === "path_segment") {
    return `${slot.type}:${slot.segmentIndex}`;
  }
  return `${slot.type}:${slot.name}:${slot.position}`;
}

function parseExampleUrl(exampleUrl: string): ParsedUrl {
  const url = new URL(exampleUrl);

  const pathSegments: Slot[] = url.pathname
    .split("/")
    .filter(Boolean)
    .map((value, index) => ({
      segmentIndex: index,
      value,
      type: "path_segment" as const,
    }));

  const querySlots: Slot[] = [];
  let pos = 0;
  for (const [name, value] of url.searchParams.entries()) {
    querySlots.push({ name, value, position: pos, type: "query_param" });
    pos += 1;
  }

  const fragmentSlots: Slot[] = [];
  if (url.hash && url.hash.length > 1) {
    const frag = url.hash.substring(1);

    // Check if fragment contains query parameters (indicated by ? or =)
    if (frag.includes("=")) {
      // If fragment contains ?, split on ? first to separate path from query
      let queryPart = frag;
      if (frag.includes("?")) {
        const parts = frag.split("?");
        // Everything after the first ? is treated as query parameters
        queryPart = parts.slice(1).join("?");
      }

      // Parse query parameters
      const pairs = queryPart.split("&");
      let pos = 0;
      pairs.forEach((pair) => {
        // Only process pairs that actually contain =
        if (pair.includes("=")) {
          const equalIndex = pair.indexOf("=");
          const name = pair.substring(0, equalIndex);
          const value = pair.substring(equalIndex + 1);
          fragmentSlots.push({
            name,
            value: decodeURIComponent(value),
            position: pos,
            type: "fragment_param",
          });
          pos += 1;
        } else if (pair.trim()) {
          // Handle parameters without values (e.g., "roomName&bedType")
          fragmentSlots.push({
            name: pair,
            value: "",
            position: pos,
            type: "fragment_param",
          });
          pos += 1;
        }
      });
    } else {
      fragmentSlots.push({
        name: "fragment",
        value: frag,
        position: 0,
        type: "fragment_param",
      });
    }
  }

  return {
    origin: url.origin,
    host: url.host,
    scheme: url.protocol.replace(":", ""),
    pathSegments,
    querySlots,
    fragmentSlots,
  };
}

function sanitizeUrlInput(raw: string): string {
  if (!raw) return "";
  let cleaned = String(raw).trim();
  cleaned = cleaned.replace(/^["']|["']$/g, "");
  cleaned = cleaned.replace(/\s+/g, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
}

function defaultFormatForVar(sourceVar: string): string {
  if (sourceVar === "checkIn" || sourceVar === "checkOut") return "YYYY-MM-DD";
  return "";
}

function guessDateFormat(value: string): string {
  if (!value) return "";
  if (value.includes("-")) return "YYYY-MM-DD";
  if (/^\d{8}$/.test(value)) return "DDMMYYYY";
  return "";
}

function autoSuggestMappings(
  parsed: ParsedUrl,
  setMappingRules: React.Dispatch<React.SetStateAction<MappingRule[]>>
): void {
  const lowerName = (name?: string) => (name || "").toLowerCase();
  const candidates = [
    ...parsed.querySlots,
    ...parsed.pathSegments,
    ...parsed.fragmentSlots,
  ];

  const newRules: MappingRule[] = [];

  candidates.forEach((slot) => {
    const name = lowerName(slot.name);
    const value = slot.value || "";
    const id = slotId(slot);

    let sourceVar: string | null = null;
    let formatPattern = "";
    let uppercase = false;

    if (
      ["checkin", "ci", "arrive", "from", "fechaentrada"].some((k) =>
        name.includes(k)
      )
    ) {
      sourceVar = "checkIn";
      formatPattern = guessDateFormat(value);
    } else if (
      ["checkout", "co", "depart", "to", "fechasalida"].some((k) =>
        name.includes(k)
      )
    ) {
      sourceVar = "checkOut";
      formatPattern = guessDateFormat(value);
    } else if (["month", "day", "year"].includes(name) && value) {
      sourceVar = "checkIn";
      formatPattern = name === "month" ? "MM" : name === "day" ? "DD" : "YYYY";
    } else if (["adult", "adults"].some((k) => name.includes(k))) {
      sourceVar = "adults";
    } else if (["child", "children"].some((k) => name.includes(k))) {
      sourceVar = "children";
    } else if (name === "currency" || name === "curr") {
      sourceVar = "currency";
    } else if (name === "promo" || name === "promocode" || name === "code") {
      sourceVar = "promoCode";
      uppercase = true;
    } else if (name.includes("hotelcode") || name.includes("hotelid")) {
      sourceVar = "hotelId";
    } else if (name === "nights") {
      sourceVar = "nights";
    }

    if (sourceVar) {
      newRules.push({
        id,
        targetType: slot.type,
        name: slot.name ?? null,
        position: slot.position ?? null,
        segmentIndex: slot.segmentIndex ?? null,
        sourceVar,
        formatPattern: formatPattern || defaultFormatForVar(sourceVar),
        uppercase,
      });
    }
  });

  setMappingRules(newRules);
}

// Main Component
export default function DeepLinkTemplateBuilder() {
  const [exampleUrl, setExampleUrl] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedUrl | null>(null);
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [slotFilter, setSlotFilter] = useState<string>("");

  const handleParse = useCallback(() => {
    const cleaned = sanitizeUrlInput(exampleUrl);
    if (!cleaned) {
      setParseError("URL is required");
      return;
    }

    try {
      const parsedUrl = parseExampleUrl(cleaned);
      setParsed(parsedUrl);
      setExampleUrl(cleaned);
      setMappingRules([]);
      setParseError(null);
      autoSuggestMappings(parsedUrl, setMappingRules);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setParseError(`Invalid URL: ${error}`);
      setParsed(null);
    }
  }, [exampleUrl]);

  const handleMappingChange = useCallback(
    (slotIdParam: string, sourceVar: string) => {
      if (!parsed) return;

      setMappingRules((prev) => {
        const existing = prev.find((r) => r.id === slotIdParam);

        if (!sourceVar) {
          return prev.filter((r) => r.id !== slotIdParam);
        }

        const slot = [
          ...parsed.pathSegments,
          ...parsed.querySlots,
          ...parsed.fragmentSlots,
        ].find((s) => {
          const id =
            s.type === "path_segment"
              ? `${s.type}:${s.segmentIndex}`
              : `${s.type}:${s.name}:${s.position}`;
          return id === slotIdParam;
        });

        if (!slot) return prev;

        const newRule: MappingRule = {
          id: slotIdParam,
          targetType: slot.type,
          name: slot.name ?? null,
          position: slot.position ?? null,
          segmentIndex: slot.segmentIndex ?? null,
          sourceVar,
          formatPattern: defaultFormatForVar(sourceVar),
          uppercase: false,
        };

        if (existing) {
          return prev.map((r) =>
            r.id === slotIdParam ? { ...newRule, ...existing, sourceVar } : r
          );
        }

        return [...prev, newRule];
      });
    },
    [parsed]
  );

  const handleFormatChange = useCallback(
    (slotIdParam: string, formatPattern: string) => {
      setMappingRules((prev) =>
        prev.map((r) => (r.id === slotIdParam ? { ...r, formatPattern } : r))
      );
    },
    []
  );

  const handleUppercaseChange = useCallback(
    (slotIdParam: string, uppercase: boolean) => {
      setMappingRules((prev) =>
        prev.map((r) => (r.id === slotIdParam ? { ...r, uppercase } : r))
      );
    },
    []
  );

  const allSlots = useMemo(() => {
    if (!parsed) return [];
    return [
      ...parsed.pathSegments,
      ...parsed.querySlots,
      ...parsed.fragmentSlots,
    ];
  }, [parsed]);

  const filteredSlots = useMemo(() => {
    if (!slotFilter) return allSlots;
    const filter = slotFilter.toLowerCase();
    return allSlots.filter((slot) => {
      const txt = `${slot.name || ""} ${slot.value || ""} ${
        slot.type
      }`.toLowerCase();
      return txt.includes(filter);
    });
  }, [allSlots, slotFilter]);

  const sortedSlots = useMemo(() => {
    return [...filteredSlots].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      if (a.segmentIndex != null && b.segmentIndex != null) {
        return a.segmentIndex - b.segmentIndex;
      }
      return (a.position ?? 0) - (b.position ?? 0);
    });
  }, [filteredSlots]);

  const getTemplate = useCallback((): Template | null => {
    if (!parsed || !exampleUrl) return null;
    return {
      exampleUrl,
      exampleParsed: parsed,
      mappingRules,
    };
  }, [parsed, exampleUrl, mappingRules]);

  const handleExportTemplate = useCallback(() => {
    const template = getTemplate();
    if (!template) {
      alert("Please parse a URL first");
      return;
    }
    console.log("Template Object:", JSON.stringify(template, null, 2));
    // In a real app, you would send this to your backend API
    // Example: await fetch('/api/templates', { method: 'POST', body: JSON.stringify(template) });
  }, [getTemplate]);

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>Deep Link Template Builder</h1>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. Parse URL</h2>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <input
            type="text"
            value={exampleUrl}
            onChange={(e) => setExampleUrl(e.target.value)}
            placeholder="https://example.com/booking?arrive=2025-12-05&depart=2025-12-08"
            style={{ flex: 1, padding: "0.5rem" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleParse();
            }}
          />
          <button onClick={handleParse} style={{ padding: "0.5rem 1rem" }}>
            Parse
          </button>
        </div>
        {parseError && <div style={{ color: "red" }}>{parseError}</div>}
        {parsed && (
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <span>Host: {parsed.host}</span>
            <span>Path segments: {parsed.pathSegments.length}</span>
            <span>Query params: {parsed.querySlots.length}</span>
            <span>Fragment params: {parsed.fragmentSlots.length}</span>
          </div>
        )}
      </section>

      {parsed && (
        <section style={{ marginBottom: "2rem" }}>
          <h2>2. Map Variables</h2>
          <div style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              value={slotFilter}
              onChange={(e) => setSlotFilter(e.target.value)}
              placeholder="Filter slots..."
              style={{ padding: "0.5rem", width: "300px" }}
            />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                  Slot
                </th>
                <th style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                  Value
                </th>
                <th style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                  Internal Variable
                </th>
                <th style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                  Format
                </th>
                <th style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                  Uppercase
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSlots.map((slot) => {
                const id =
                  slot.type === "path_segment"
                    ? `${slot.type}:${slot.segmentIndex}`
                    : `${slot.type}:${slot.name}:${slot.position}`;
                const rule = mappingRules.find((r) => r.id === id);
                const slotLabel =
                  slot.type === "path_segment"
                    ? `SEG ${slot.segmentIndex}`
                    : `${slot.name || "?"} (#${slot.position ?? 0})`;
                const isDate =
                  rule?.sourceVar === "checkIn" ||
                  rule?.sourceVar === "checkOut";

                return (
                  <tr key={id}>
                    <td style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                      {slotLabel}
                    </td>
                    <td style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                      {slot.value}
                    </td>
                    <td style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                      <select
                        value={rule?.sourceVar || ""}
                        onChange={(e) =>
                          handleMappingChange(id, e.target.value)
                        }
                        style={{ width: "100%", padding: "0.25rem" }}
                      >
                        <option value="">— Unassigned —</option>
                        {INTERNAL_VARIABLES.map((v) => (
                          <option key={v.key} value={v.key}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                      {isDate ? (
                        <input
                          type="text"
                          value={rule?.formatPattern || ""}
                          onChange={(e) =>
                            handleFormatChange(id, e.target.value)
                          }
                          placeholder="YYYY-MM-DD"
                          style={{ width: "100%", padding: "0.25rem" }}
                        />
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td style={{ border: "1px solid #ddd", padding: "0.5rem" }}>
                      {rule?.sourceVar ? (
                        <input
                          type="checkbox"
                          checked={rule?.uppercase || false}
                          onChange={(e) =>
                            handleUppercaseChange(id, e.target.checked)
                          }
                        />
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {parsed && (
        <section>
          <h2>3. Export Template</h2>
          <button
            onClick={handleExportTemplate}
            style={{ padding: "0.5rem 1rem" }}
          >
            Export Template Object
          </button>
          <pre
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "#f5f5f5",
              overflow: "auto",
            }}
          >
            {JSON.stringify(getTemplate(), null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
