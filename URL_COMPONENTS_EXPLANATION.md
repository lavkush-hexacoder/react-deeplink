# Simple Explanation: URL Components

## A URL has 3 main parts that this code extracts:

### Example URL:
```
https://example.com/hotels/paris?checkIn=2025-12-05&adults=2#room?bedType=king&view=ocean
```

---

## 1. **PATH SEGMENTS** (the route/path)
**Location:** Between domain and `?`
**Example:** `/hotels/paris`

- These are the parts of the URL path separated by `/`
- In the example: `hotels` and `paris` are path segments
- **Parsed as:** `pathSegments` array
- **Type:** `"path_segment"`
- **Has:** `segmentIndex` (0, 1, 2...) and `value` (the segment text)

**Code extracts:**
```javascript
url.pathname.split("/")  // ["", "hotels", "paris"]
// Results in:
// - segmentIndex: 0, value: "hotels"
// - segmentIndex: 1, value: "paris"
```

---

## 2. **QUERY PARAMETERS** (the `?` part)
**Location:** After `?` and before `#`
**Example:** `?checkIn=2025-12-05&adults=2`

- These are key-value pairs after the `?`
- Format: `name=value&name2=value2`
- In the example: `checkIn=2025-12-05` and `adults=2`
- **Parsed as:** `querySlots` array
- **Type:** `"query_param"`
- **Has:** `name`, `value`, and `position` (0, 1, 2...)

**Code extracts:**
```javascript
url.searchParams  // Built-in browser API
// Results in:
// - name: "checkIn", value: "2025-12-05", position: 0
// - name: "adults", value: "2", position: 1
```

---

## 3. **FRAGMENT** (the `#` part)
**Location:** Everything after `#`
**Example:** `#room?bedType=king&view=ocean`

- This is the hash/fragment part of the URL
- Can be:
  - Simple text: `#section1`
  - Path-like: `#room/details`
  - Query-like: `#bedType=king&view=ocean`
  - Mixed: `#room?bedType=king&view=ocean`
- **Parsed as:** `fragmentSlots` array
- **Type:** `"fragment_param"`
- **Has:** `name`, `value`, and `position`

**Code extracts:**
```javascript
url.hash.substring(1)  // Remove the "#"
// If it has "?" → splits into path part + query params
// If it has "=" or "&" → treats as query parameters
// Otherwise → treats as simple fragment text
```

---

## Visual Breakdown:

```
https://example.com/hotels/paris?checkIn=2025-12-05&adults=2#room?bedType=king&view=ocean
│                    │              │                        │
│                    │              │                        └─ FRAGMENT (#room?bedType=king&view=ocean)
│                    │              └─ QUERY PARAMS (?checkIn=2025-12-05&adults=2)
│                    └─ PATH SEGMENTS (/hotels/paris)
└─ Domain
```

---

## Why 3 separate arrays?

Each part of the URL serves different purposes:
- **Path segments:** Define the route/page (e.g., `/hotels/paris`)
- **Query params:** Pass data to the server (e.g., `?checkIn=2025-12-05`)
- **Fragment:** Usually for client-side navigation (e.g., `#section1`)

This code extracts all three so you can map them to internal variables (like `checkIn`, `adults`, etc.)

---

## Real Examples:

### Example 1: Simple URL
```
https://booking.com/hotels/paris?checkIn=2025-12-05&adults=2
```
- **Path segments:** `["hotels", "paris"]`
- **Query params:** `[{name: "checkIn", value: "2025-12-05"}, {name: "adults", value: "2"}]`
- **Fragment:** `[]` (empty)

### Example 2: With Fragment
```
https://booking.com/hotels/paris?checkIn=2025-12-05#room?bedType=king
```
- **Path segments:** `["hotels", "paris"]`
- **Query params:** `[{name: "checkIn", value: "2025-12-05"}]`
- **Fragment:** `[{name: "fragment_path", value: "room"}, {name: "bedType", value: "king"}]`

### Example 3: Complex Fragment
```
https://booking.com/hotels#bedType=king&view=ocean&floor=10
```
- **Path segments:** `["hotels"]`
- **Query params:** `[]` (empty)
- **Fragment:** `[{name: "bedType", value: "king"}, {name: "view", value: "ocean"}, {name: "floor", value: "10"}]`

