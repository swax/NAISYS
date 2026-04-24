# Computer Use

[← Back to main README](../README.md)

NAISYS gives an agent a real desktop to see and operate, alongside (or
instead of) its shell. The model takes scaled screenshots, emits tool
calls in the same coord space it saw, and a single service translates
those coords to real screen pixels.

For host setup (XFCE + VNC on Ubuntu) see the
[XFCE/VNC guide](../guides/xfce-computer-use.md).

This doc covers:

- The three coordinate spaces the system juggles
- How an action flows from model emission to the platform backend
- Focus — zooming the model into a subsection of the display
- Per-vendor coord contracts (Anthropic / OpenAI / Google)
- The manual `ns-desktop` shell commands, which mirror the LLM path

## Why this is non-trivial

Between the model's screenshot and a real pixel on the screen, several
transformations stack up:

- **Downscaling.** Native resolutions (often 4K) are too large to hand to
  a vision API — Anthropic caps images at ~1.15MP / 1568px longest edge,
  and every vendor burns tokens on larger images. We scale to
  `TARGET_MEGAPIXELS = 1.1` so the model sees a compact image and emits
  compact coords.
- **Focus / cropping.** The operator can zoom the model into any
  subsection of the screen (`ns-desktop focus X Y W H`). After focus,
  screenshots, coords, and actions all live inside the cropped viewport.
- **Vendor coord spaces.** Anthropic and OpenAI send scaled pixel coords.
  Google sends a 0–999 normalized grid. We unify to a single internal
  form.
- **Replay.** Actions stored in context are replayed back to the API on
  the next turn. If the stored coord differs from what the model
  originally emitted, the model sees inconsistent history.

The design keeps these concerns in exactly one place each.

## Three coordinate spaces

Two spatial levels and a resolution transform.

**Native screen** — the physical display. `nativeDisplayWidth/Height` in
`DesktopConfig`. Unchanged by focus.

**Viewport** — a sub-rectangle of the native screen. When unfocused it
covers the full display; when focused it's whatever rect the operator
picked. `viewport: { x, y, width, height }` — `x/y` is the origin on
native, `width/height` is the size at native resolution.
**Viewport ⊂ Native** spatially.

**Scaled** — the viewport *resized* to fit `TARGET_MEGAPIXELS`. This is
what the model sees in screenshots and the coord space it emits in tool
calls. `scaledWidth/Height` in `DesktopConfig`. **Not** a spatial subset
of the viewport — same content at a different resolution. Often equal
to the viewport (when the viewport is already under target).

All three are precomputed on `DesktopConfig` by
`computerService.getConfig()`; consumers read them rather than
recomputing `getTargetScaleFactor` at call sites.

```ts
interface DesktopConfig {
  nativeDisplayWidth, nativeDisplayHeight;   // physical display
  viewport: { x, y, width, height };         // focus rect (or full display)
  scaledWidth, scaledHeight;                 // viewport sized for the model
  scaleFactor;                               // viewport.w × scaleFactor ≈ scaledWidth
  desktopPlatform;
}
```

## The action pipeline

Coordinates live in **scaled (API) space** from emission until execute
time. The vendor extractors do no coord math; `ComputerService` does
all translation at the last step.

```
LLM tool call
    │   coord in scaled pixels (A/O) or 0–999 (Google)
    ▼
vendor extractDesktopActions
    │   Google: 0–999 → scaled.  A/O: pure pass-through.
    ▼
DesktopAction{ input: { actions: [...] } }   ← coords in scaled space
    │
    ├── context.appendDesktopRequest   ← stored as-is for replay
    │
    ▼
computerService.executeAction(action)
    │   scaled → viewport-local → screen (single multiply + add per axis)
    ▼
platform backend (windowsDesktop / macosDesktop / x11Desktop / waylandDesktop)
```

**Why store in scaled space:** the stored coord is identical to what
the model emitted, so replaying the context back to the API is a pure
pass-through. Focused-viewport actions don't feed the model different
numbers than it saw. Bounds checks and error messages are in the same
frame the model emitted in, so a tool-error tells the model "coordinate
(X, Y) is outside 1380×776" using *its* X and Y.

The translation itself is a single helper in
`computerService.translateScaledActionToScreen`:

```
screen_x = round((scaled_x / scaledWidth) × viewport.width) + viewport.x
screen_y = round((scaled_y / scaledHeight) × viewport.height) + viewport.y
```

## Focus

Focus zooms the model into a subsection of the display. It's the only
affordance the operator has to work around:

- Screens too big to downscale without losing detail (4K → 1.1MP loses
  a lot of pixels per inch)
- Tasks concentrated in one area where the rest is irrelevant context

```
ns-desktop focus X Y W H   ← args in scaled-screenshot pixels
```

`mapScreenshotRectToScreen` maps those args to an absolute-screen rect
and calls `setFocus`, which stores the new viewport. `getConfig()` then
returns the focused viewport, with `scaledWidth/Height` recomputed for
it (usually ≤ target, so the scaled screenshot is 1:1 with the viewport
at native resolution).

**Actions are stamped with their emission-time viewport.**
`attachViewportToActions` writes `viewport: {x,y,w,h}` into
`action.input` before the action is appended to context. Replay paths
(especially Google's `reconstructGoogleArgs`) read this stamp instead
of the current viewport — so an action emitted against the full desktop
replays correctly even if the operator focuses afterward.

**Focus changes are expensive.** They invalidate computer-use prompt
caching on Anthropic and force a full context refresh elsewhere. The
`ns-desktop focus` command surfaces a cost warning after each change.

## Vendor coord contracts

### Anthropic / OpenAI

- Model is told the screen is `(scaledWidth, scaledHeight)`.
- Model emits coords in that space.
- `extractDesktopActions` wraps `block.input` verbatim — no coord math.
- Replay: the stored tool_use block is fed straight back to the API.

### Google

- Model is told nothing about resolution. Emits coords in a 0–999
  normalized grid.
- `convertGoogleActionToInternal` denormalizes `0..999 → scaledWidth/
  Height` and maps Google's named functions (`click_at`, `scroll_at`,
  `type_text_at`, …) to the internal Anthropic-style action names
  (`left_click`, `scroll`, …).
- Replay: `reconstructGoogleArgs` does the inverse, using the viewport
  dims stamped on the stored action (via `attachViewportToActions`) so
  a later focus change can't misalign the replayed coords.

Google's extractor is the only one that *must* touch coords on the way
in, because its API space isn't the scaled space. It still lands in the
same internal format.

## Manual `ns-desktop` commands

The shell commands exist so the operator — or a model without native
computer-use tooling — can drive the desktop through the shell. They
share the same coord contract as the LLM path: scaled coords in, scaled
coords into `executeAction`, ComputerService translates.

| Subcommand | Purpose |
|---|---|
| `screenshot` | Capture the scaled viewport and append to context |
| `focus X Y W H` | Set focus (args in scaled pixels); `focus clear` resets |
| `click X Y [button]` | Click at scaled-screenshot coords |
| `key <combo>` | Press a key (`ctrl+l`, `alt+tab`, …) |
| `hold <combo> <ms>` | Hold a key for a duration |
| `type <text>` | Type text |
| `dump` | Save full / viewport-native / scaled screenshots for debugging |

For vendors with native computer-use tool support, the subcommands
that duplicate the native tool (`screenshot`, `click`, `key`, `type`)
are hidden from `ns-desktop help` — the model should use its native
tool. `hold` stays visible because Anthropic is the only vendor that
exposes it natively, and even there the shell gives finer timing
control.

## Screenshot pipeline

Three capture entry points in `ComputerService`:

| Function | Area | Resolution |
|---|---|---|
| `captureFullScreenshot` | Full physical display | Native |
| `captureViewportScreenshot` | Focused viewport, cropped | Native |
| `captureScaledScreenshot` | Focused viewport, resized | Scaled (`TARGET_MEGAPIXELS`) |

`captureScaledScreenshot` composes the others: capture full → crop to
viewport → resize to scaled. Screenshots cache under
`$NAISYS_FOLDER/tmp/naisys/screenshots/` and are reaped after 10
minutes.

**Anthropic guardrail at startup.** Anthropic caps images at ~1.15MP
and 1568px longest edge; beyond that, the API silently downscales,
wasting the resolution we picked. `logStartup` warns if the scaled
image exceeds either limit — the fix is lowering `TARGET_MEGAPIXELS`,
not adding a post-hoc resize.

## Confirmation flow

`desktopService.confirmAndExecuteActions`:

1. Log each action for the operator (formatted as
   `scaled → screen` coords for clarity).
2. Prompt `Execute desktop actions? [Y/n]` (auto-approves on timeout
   when the console is disabled — the agent is running headless).
3. Append the assistant's tool_use to context.
4. For each action: bounds-check against `scaledWidth/Height` →
   execute → capture a fresh scaled screenshot → append the
   tool_result with that screenshot.

Bounds violations and backend failures become tool_result errors with
the fresh screenshot attached, so the model has a current view to
retry against.

## Platform backends

One file per display server, all exposing the same surface:

| Backend | Used when |
|---|---|
| `windowsDesktop.ts` | `process.platform === "win32"` or `WSL_DISTRO_NAME` set (WSL controls the Windows host via `powershell.exe` rather than WSLg, since WSLg only exposes Linux GUI apps) |
| `macosDesktop.ts` | `process.platform === "darwin"` |
| `x11Desktop.ts` | `DISPLAY` set or `XDG_SESSION_TYPE === "x11"` |
| `waylandDesktop.ts` | `WAYLAND_DISPLAY` set or `XDG_SESSION_TYPE === "wayland"` |

Each exports `captureScreenshot`, `mouseClick`, `mouseDoubleClick`,
`mouseMove`, `mouseDrag`, `mouseScroll`, `typeText`, `pressKey`,
`holdKey`. On headless boxes (no display server) `detectPlatform()`
returns `null` and desktop mode fails to init with a clear error
surfaced at agent startup.
