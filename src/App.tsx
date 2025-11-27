import React, { useState, useCallback, useMemo } from "react";

// Types
interface Slot {
  type:
    | "path_segment"
    | "query_param"
    | "fragment_path_segment"
    | "fragment_query_param";
  name?: string;
  value: string;
  index: number;
}

interface ParsedUrl {
  origin: string;
  host: string;
  scheme: string;
  pathSlots: Slot[];
  querySlots: Slot[];
  fragmentPathSlots: Slot[];
  fragmentQuerySlots: Slot[];
}

interface MappingRule {
  id: string;
  targetType: Slot["type"];
  name: string | null;
  index: number | null;
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
  if (slot.type === "path_segment" || slot.type === "fragment_path_segment") {
    return `${slot.type}:${slot.index}`;
  }
  return `${slot.type}:${slot.name}:${slot.index}`;
}

function parseExampleUrl(exampleUrl: string): ParsedUrl {
  const url = new URL(exampleUrl);

  const pathSlots: Slot[] = url.pathname
    .split("/")
    .filter(Boolean)
    .map((value, index) => ({
      index,
      value,
      type: "path_segment" as const,
    }));

  const querySlots: Slot[] = [];
  let index = 0;
  for (const [name, value] of url.searchParams.entries()) {
    querySlots.push({ name, value, index, type: "query_param" });
    index += 1;
  }

  const fragmentPathSlots: Slot[] = [];
  const fragmentQuerySlots: Slot[] = [];

  if (url.hash && url.hash.length > 1) {
    const frag = url.hash.substring(1);

    // Check if fragment contains query parameters (indicated by ?)
    if (frag.includes("?")) {
      // Split on ? to separate path from query parameters
      const parts = frag.split("?");
      const pathPart = parts[0];
      const queryPart = parts.slice(1).join("?"); // Rejoin in case there are multiple ?s

      // Parse path part into individual segments (e.g., "/booking/a/" -> ["booking", "a"])
      if (pathPart) {
        const segments = pathPart.split("/").filter(Boolean); // Filter out empty strings from leading/trailing slashes
        segments.forEach((segment, index) => {
          fragmentPathSlots.push({
            value: segment,
            index,
            type: "fragment_path_segment",
          });
        });
      }

      // Parse query parameters after the ?
      if (queryPart) {
        const pairs = queryPart.split("&");
        let index = 0;
        pairs.forEach((pair) => {
          const trimmedPair = pair.trim();
          if (!trimmedPair) return; // Skip empty pairs

          if (trimmedPair.includes("=")) {
            const equalIndex = trimmedPair.indexOf("=");
            const name = trimmedPair.substring(0, equalIndex);
            const value = trimmedPair.substring(equalIndex + 1);
            fragmentQuerySlots.push({
              name: decodeURIComponent(name),
              value: decodeURIComponent(value),
              index,
              type: "fragment_query_param",
            });
            index += 1;
          } else {
            // Handle parameters without values (e.g., "roomName&bedType")
            fragmentQuerySlots.push({
              name: decodeURIComponent(trimmedPair),
              value: "",
              index,
              type: "fragment_query_param",
            });
            index += 1;
          }
        });
      }
    } else if (frag.includes("=") || frag.includes("&")) {
      // Fragment has query-like structure but no ? separator
      // Treat entire fragment as query parameters
      const pairs = frag.split("&");
      let index = 0;
      pairs.forEach((pair) => {
        const trimmedPair = pair.trim();
        if (!trimmedPair) return; // Skip empty pairs

        if (trimmedPair.includes("=")) {
          const equalIndex = trimmedPair.indexOf("=");
          const name = trimmedPair.substring(0, equalIndex);
          const value = trimmedPair.substring(equalIndex + 1);
          fragmentQuerySlots.push({
            name: decodeURIComponent(name),
            value: decodeURIComponent(value),
            index,
            type: "fragment_query_param",
          });
          index += 1;
        } else {
          // Handle parameters without values
          fragmentQuerySlots.push({
            name: decodeURIComponent(trimmedPair),
            value: "",
            index,
            type: "fragment_query_param",
          });
          index += 1;
        }
      });
    } else {
      // Simple fragment without query parameters
      // Check if it looks like a path (starts with /) and parse as segments
      if (frag.startsWith("/")) {
        const segments = frag.split("/").filter(Boolean);
        segments.forEach((segment, index) => {
          fragmentPathSlots.push({
            value: segment,
            index,
            type: "fragment_path_segment",
          });
        });
      } else {
        // Simple text fragment - treat as a single path segment
        fragmentPathSlots.push({
          value: frag,
          index: 0,
          type: "fragment_path_segment",
        });
      }
    }
  }

  return {
    origin: url.origin,
    host: url.host,
    scheme: url.protocol.replace(":", ""),
    pathSlots,
    querySlots,
    fragmentPathSlots,
    fragmentQuerySlots,
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
    ...parsed.pathSlots,
    ...parsed.fragmentPathSlots,
    ...parsed.fragmentQuerySlots,
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
        index: slot.index,
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
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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
          ...parsed.pathSlots,
          ...parsed.querySlots,
          ...parsed.fragmentPathSlots,
          ...parsed.fragmentQuerySlots,
        ].find((s) => {
          const id =
            s.type === "path_segment" || s.type === "fragment_path_segment"
              ? `${s.type}:${s.index}`
              : `${s.type}:${s.name}:${s.index}`;
          return id === slotIdParam;
        });

        if (!slot) return prev;

        const newRule: MappingRule = {
          id: slotIdParam,
          targetType: slot.type,
          name: slot.name ?? null,
          index: slot.index,
          sourceVar,
          formatPattern: defaultFormatForVar(sourceVar),
          uppercase: false,
        };

        if (existing) {
          // If sourceVar changed, reset formatPattern to default for new sourceVar
          // This ensures formatPattern is cleared when switching from date to non-date fields
          const formatPattern = defaultFormatForVar(sourceVar);
          // Preserve uppercase setting if sourceVar didn't change, otherwise reset to false
          const uppercase =
            existing.sourceVar === sourceVar ? existing.uppercase : false;

          return prev.map((r) =>
            r.id === slotIdParam
              ? { ...newRule, formatPattern, sourceVar, uppercase }
              : r
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
      ...parsed.pathSlots,
      ...parsed.querySlots,
      ...parsed.fragmentPathSlots,
      ...parsed.fragmentQuerySlots,
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
      // Define type order for consistent sorting
      const typeOrder: Record<string, number> = {
        path_segment: 0,
        query_param: 1,
        fragment_path_segment: 2,
        fragment_query_param: 3,
      };
      const aOrder = typeOrder[a.type] ?? 999;
      const bOrder = typeOrder[b.type] ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;

      return a.index - b.index;
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

  const handleSaveTemplate = useCallback(async () => {
    const template = getTemplate();
    if (!template) {
      setSaveMessage("Please parse a URL first");
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch(
        "http://localhost:3000/channel-partner/078c2c3d-354d-4d0b-8de5-ceeb16187194/configV2",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(template),
        }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: "Failed to save template" }));
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      const result = await response.json();
      setSaveMessage("Template saved successfully!");
      console.log("Template saved:", result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save template";
      setSaveMessage(`Error: ${errorMessage}`);
      console.error("Error saving template:", error);
    } finally {
      setIsSaving(false);
    }
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
            <span>Path slots: {parsed.pathSlots.length}</span>
            <span>Query params: {parsed.querySlots.length}</span>
            <span>Fragment paths: {parsed.fragmentPathSlots.length}</span>
            <span>Fragment queries: {parsed.fragmentQuerySlots.length}</span>
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
                  slot.type === "path_segment" ||
                  slot.type === "fragment_path_segment"
                    ? `${slot.type}:${slot.index}`
                    : `${slot.type}:${slot.name}:${slot.index}`;
                const rule = mappingRules.find((r) => r.id === id);
                const slotLabel =
                  slot.type === "path_segment"
                    ? `SEG ${slot.index}`
                    : slot.type === "fragment_path_segment"
                    ? `FRAG_PATH ${slot.index}`
                    : `${slot.name || "?"} (#${slot.index})`;
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
          <h2>3. Save Template</h2>
          <div style={{ marginBottom: "1rem" }}>
            <button
              onClick={handleSaveTemplate}
              disabled={isSaving}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: isSaving ? "#ccc" : "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              {isSaving ? "Saving..." : "Save Template"}
            </button>
            {saveMessage && (
              <div
                style={{
                  marginTop: "0.5rem",
                  color: saveMessage.startsWith("Error") ? "red" : "green",
                }}
              >
                {saveMessage}
              </div>
            )}
          </div>
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
