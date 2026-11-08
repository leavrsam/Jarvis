// The HUD's widgets. Wide screens: free-floating cards you can move and resize in layout mode.
// Phones / tablets: a stack under the voice screen you can reorder. Hidden widgets, positions
// and order are saved on this device (services/hudLayout.ts).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, LayoutGrid, Minus, Move, Plus, RotateCcw, X } from 'lucide-react';
import { WidgetIcon } from './widgetIcons';
import {
  GRID,
  HudLayout,
  Rect,
  Viewport,
  WIDGETS,
  WidgetId,
  addWidget,
  clampRect,
  collapseWidget,
  expandWidget,
  isOnBoard,
  isShown,
  removeWidget,
  emptyLayout,
  loadLayout,
  moveInOrder,
  resolveRects,
  saveLayout,
  snap,
  widgetInfo,
  withRect,
} from '../../services/hudLayout';

/** Wide-screen layout from this width up (Tailwind's lg) */
export const WIDE_QUERY = '(min-width: 1024px)';

export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

// ---------------------------------------------------------------------------- Edit toolbar

const EditToolbar: React.FC<{
  wide: boolean;
  onLibrary: () => void;
  onReset: () => void;
  onDone: () => void;
}> = ({ wide, onLibrary, onReset, onDone }) => (
  <div
    className={`${wide ? 'fixed bottom-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-32px)]' : 'sticky top-2 mx-3'} z-[60] hud-panel px-3 py-2 flex flex-wrap items-center gap-2 text-[12px] text-amber-200 shadow-[0_0_30px_rgba(245,158,11,0.25)]`}
    role="toolbar"
    aria-label="Edit layout"
  >
    <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
      <Move className="w-3.5 h-3.5" />
      {wide ? 'Drag to move · drag any edge or corner to resize' : 'Reorder, minimise or remove widgets'}
    </span>
    <button
      onClick={onLibrary}
      className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-500/70 bg-amber-950/50 text-amber-100 hover:bg-amber-900/50"
    >
      <Plus className="w-3 h-3" />
      Add widgets
    </button>
    <span className="flex-1" />
    <button onClick={onReset} className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-800/60 text-amber-400 hover:bg-amber-900/40">
      <RotateCcw className="w-3 h-3" />
      Reset
    </button>
    <button onClick={onDone} className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-400 text-amber-100 hover:bg-amber-500/35">
      <Check className="w-3 h-3" />
      Done
    </button>
  </div>
);

// ---------------------------------------------------------------------------- Library

const WidgetLibrary: React.FC<{
  layout: HudLayout;
  wide: boolean;
  onAdd: (id: WidgetId) => void;
  onRestore: (id: WidgetId) => void;
  onRemove: (id: WidgetId) => void;
  onClose: () => void;
}> = ({ layout, wide, onAdd, onRestore, onRemove, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const list = WIDGETS.filter((w) => wide || w.mobile);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose} role="dialog" aria-label="Widget library">
      <div className="hud-panel w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-amber-900/40">
          <span className="flex items-center gap-2 hud-label">
            <LayoutGrid className="w-3.5 h-3.5" /> Widgets
          </span>
          <button onClick={onClose} className="p-1.5 text-amber-500 hover:text-amber-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto hud-scroll p-4 grid gap-2.5 sm:grid-cols-2">
          {list.map((w) => {
            const on = isOnBoard(layout, w.id);
            const minimised = on && layout.collapsed.includes(w.id);
            return (
              <div key={w.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${on ? 'border-amber-600/50 bg-amber-950/25' : 'border-amber-900/50 bg-black/30'}`}>
                <div className="w-9 h-9 rounded-lg border border-amber-700/50 bg-black/40 flex items-center justify-center shrink-0">
                  <WidgetIcon id={w.id} className="w-4 h-4 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] text-amber-100 font-semibold">{w.label}</div>
                  <div className="text-[12px] text-amber-500/90 leading-snug">{w.description}</div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  {!on && (
                    <button onClick={() => onAdd(w.id)} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold hover:bg-amber-400">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                  {minimised && (
                    <button onClick={() => onRestore(w.id)} className="px-2.5 py-1 rounded-full border border-amber-500/70 text-amber-100 text-[12px] hover:bg-amber-900/40">
                      Restore
                    </button>
                  )}
                  {on && !minimised && <span className="px-2 py-0.5 text-[11px] text-emerald-300/90">On screen</span>}
                  {on && (
                    <button onClick={() => onRemove(w.id)} className="px-2 py-0.5 text-[11px] text-amber-600 hover:text-red-300">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- Dock (minimised widgets)

const Dock: React.FC<{ ids: WidgetId[]; wide: boolean; editing: boolean; onRestore: (id: WidgetId) => void }> = ({ ids, wide, editing, onRestore }) => {
  if (!ids.length) return null;
  return (
    <div
      className={
        wide
          ? `fixed left-1/2 -translate-x-1/2 ${editing ? 'bottom-[76px]' : 'bottom-3'} z-[58] flex items-center gap-1.5 hud-panel px-2 py-1.5`
          : 'flex flex-wrap justify-center gap-1.5 mb-3'
      }
      role="toolbar"
      aria-label="Minimised widgets"
    >
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => onRestore(id)}
          title={`Show ${widgetInfo(id).label}`}
          aria-label={`Show ${widgetInfo(id).label}`}
          className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-amber-700/60 bg-black/50 text-amber-300 hover:border-amber-400 hover:text-amber-100 transition-colors"
        >
          <WidgetIcon id={id} className="w-3.5 h-3.5" />
          <span className="text-[11.5px]">{widgetInfo(id).label}</span>
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------- Wide: free frame

/** Which edges a drag moves: n/s/e/w combinations for resizing, or the whole card */
type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: { mode: Exclude<DragMode, 'move'>; className: string; cursor: string }[] = [
  { mode: 'nw', className: '-left-1.5 -top-1.5 w-5 h-5', cursor: 'cursor-nwse-resize' },
  { mode: 'ne', className: '-right-1.5 -top-1.5 w-5 h-5', cursor: 'cursor-nesw-resize' },
  { mode: 'sw', className: '-left-1.5 -bottom-1.5 w-5 h-5', cursor: 'cursor-nesw-resize' },
  { mode: 'se', className: '-right-1.5 -bottom-1.5 w-5 h-5', cursor: 'cursor-nwse-resize' },
  { mode: 'n', className: 'left-5 right-5 -top-1 h-2.5', cursor: 'cursor-ns-resize' },
  { mode: 's', className: 'left-5 right-5 -bottom-1 h-2.5', cursor: 'cursor-ns-resize' },
  { mode: 'w', className: 'top-5 bottom-5 -left-1 w-2.5', cursor: 'cursor-ew-resize' },
  { mode: 'e', className: 'top-5 bottom-5 -right-1 w-2.5', cursor: 'cursor-ew-resize' },
];

/** New rect for a drag: edges named in `mode` follow the pointer; the opposite edges stay put */
function dragRect(mode: DragMode, start: Rect, dx: number, dy: number, id: WidgetId): Rect {
  if (mode === 'move') return { ...start, x: snap(start.x + dx), y: snap(start.y + dy) };
  const { minW, minH } = widgetInfo(id);
  let { x, y, w, h } = start;
  if (mode.includes('e')) w = Math.max(minW, snap(start.w + dx));
  if (mode.includes('s')) h = Math.max(minH, snap(start.h + dy));
  if (mode.includes('w')) {
    w = Math.max(minW, snap(start.w - dx));
    x = start.x + start.w - w;
  }
  if (mode.includes('n')) {
    h = Math.max(minH, snap(start.h - dy));
    y = start.y + start.h - h;
  }
  return { x, y, w, h };
}

const WidgetFrame: React.FC<{
  id: WidgetId;
  rect: Rect;
  vp: Viewport;
  editing: boolean;
  z: number;
  onCommit: (id: WidgetId, rect: Rect) => void;
  onMinimise: (id: WidgetId) => void;
  onRemove: (id: WidgetId) => void;
  onFocus: (id: WidgetId) => void;
  children: React.ReactNode;
}> = ({ id, rect, vp, editing, z, onCommit, onMinimise, onRemove, onFocus, children }) => {
  const [live, setLive] = useState<Rect | null>(null);
  const drag = useRef<{ mode: DragMode; px: number; py: number; start: Rect } | null>(null);
  const r = live ?? rect;
  const label = widgetInfo(id).label;

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
    onFocus(id);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setLive(clampRect(dragRect(d.mode, d.start, e.clientX - d.px, e.clientY - d.py, id), vp, id));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (live) onCommit(id, live);
    setLive(null);
  };

  // Keyboard: arrows move, Shift+arrows resize
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const [dx, dy] = step;
    onCommit(id, e.shiftKey ? { ...rect, w: rect.w + dx, h: rect.h + dy } : { ...rect, x: rect.x + dx, y: rect.y + dy });
  };

  return (
    <div
      className={`absolute hud-widget ${editing ? '' : 'pointer-events-none'} ${live ? '' : 'transition-[left,top,width,height] duration-150'}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: live ? 55 : z }}
      data-widget={id}
    >
      <div className={`hud-widget-body w-full h-full ${editing ? 'pointer-events-none select-none opacity-80' : '[&>*]:pointer-events-auto'}`}>
        {children}
      </div>
      {editing && (
        <div
          className="absolute inset-0 rounded-[14px] border-2 border-dashed border-amber-400/70 bg-amber-500/[0.04] cursor-move touch-none focus:outline-none focus:border-amber-200"
          onPointerDown={begin('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={onKey}
          tabIndex={0}
          role="group"
          aria-label={`${label} widget. Arrow keys move it, Shift plus arrow keys resize it.`}
        >
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2">
            <span className="px-2 py-0.5 rounded bg-black/80 border border-amber-600/60 text-[11px] font-semibold text-amber-200">
              {label}
              <span className="ml-2 font-mono-tech text-amber-500/90">
                {Math.round(r.w)}×{Math.round(r.h)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMinimise(id)}
                className="p-1.5 rounded bg-black/80 border border-amber-700/60 text-amber-300 hover:text-amber-100"
                title={`Minimise ${label} (it waits in the dock at the bottom)`}
                aria-label={`Minimise ${label}`}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(id)}
                className="p-1.5 rounded bg-black/80 border border-amber-700/60 text-amber-300 hover:text-red-300"
                title={`Remove ${label} (add it back from Add widgets)`}
                aria-label={`Remove ${label}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>
          {HANDLES.map((hd) => (
            <div
              key={hd.mode}
              className={`absolute ${hd.className} ${hd.cursor} touch-none flex items-center justify-center`}
              onPointerDown={begin(hd.mode)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              title="Drag to resize"
            >
              {hd.mode.length === 2 && <span className="block w-2.5 h-2.5 rounded-sm bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------- Board

export interface WidgetBoardProps {
  wide: boolean;
  editing: boolean;
  onDoneEditing: () => void;
  /** The content of each widget (in layout mode, empty widgets should render a placeholder) */
  render: (id: WidgetId, editing: boolean) => React.ReactNode;
}

export const WidgetBoard: React.FC<WidgetBoardProps> = ({ wide, editing, onDoneEditing, render }) => {
  const [layout, setLayout] = useState<HudLayout>(() => loadLayout());
  const [front, setFront] = useState<WidgetId[]>([]);
  const vp = useViewport();

  const update = useCallback((next: HudLayout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  // Esc leaves layout mode
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDoneEditing();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onDoneEditing]);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const remove = (id: WidgetId) => update(removeWidget(layout, id));
  const add = (id: WidgetId) => update(addWidget(layout, id, wide ? vp : undefined));
  const minimise = (id: WidgetId) => update(collapseWidget(layout, id));
  const restore = (id: WidgetId) => {
    update(expandWidget(layout, id));
    setFront((f) => [...f.filter((x) => x !== id), id]);
  };
  const dockIds = layout.collapsed.filter((id) => isOnBoard(layout, id) && (wide || widgetInfo(id).mobile));
  const library = libraryOpen && (
    <WidgetLibrary layout={layout} wide={wide} onAdd={add} onRestore={restore} onRemove={remove} onClose={() => setLibraryOpen(false)} />
  );
  const reset = () => {
    update(emptyLayout());
    setFront([]);
  };
  const toFront = (id: WidgetId) => setFront((f) => [...f.filter((x) => x !== id), id]);

  if (wide) {
    const rects = resolveRects(layout, vp);
    const ids = WIDGETS.map((w) => w.id).filter((id) => isShown(layout, id));
    return (
      <>
        {editing && <EditToolbar wide onLibrary={() => setLibraryOpen(true)} onReset={reset} onDone={onDoneEditing} />}
        <Dock ids={dockIds} wide editing={editing} onRestore={restore} />
        {library}
        {ids.map((id) => (
          <WidgetFrame
            key={id}
            id={id}
            rect={rects[id]}
            vp={vp}
            editing={editing}
            z={20 + Math.max(0, front.indexOf(id) + 1)}
            onCommit={(wid, rect) => update(withRect(layout, vp, wid, rect))}
            onMinimise={minimise}
            onRemove={remove}
            onFocus={toFront}
          >
            {render(id, editing)}
          </WidgetFrame>
        ))}
      </>
    );
  }

  // Phones / tablets: a reorderable stack
  const mobileIds = layout.order.filter((id) => widgetInfo(id).mobile);
  const visible = mobileIds.filter((id) => isShown(layout, id));
  const notShown = mobileIds.filter((id) => !isShown(layout, id));
  return (
    <section className="relative z-20 px-3 pb-8 pb-safe" aria-label="Widgets">
      {/* Peeks out below the voice screen so it's clear there's more to scroll to */}
      <div className="h-10 flex items-center justify-center gap-1.5 text-[11px] font-orbitron tracking-[0.25em] text-amber-500/80">
        <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
        AT A GLANCE
      </div>
      {editing && <EditToolbar wide={false} onLibrary={() => setLibraryOpen(true)} onReset={reset} onDone={onDoneEditing} />}
      <Dock ids={dockIds} wide={false} editing={editing} onRestore={restore} />
      {library}
      <div className="mx-auto max-w-xl grid gap-3 mt-1 sm:grid-cols-2 sm:max-w-3xl">
        {visible.map((id, i) => (
          <div key={id} className={`relative hud-widget-stack ${id === 'calendar' || id === 'system' ? 'sm:col-span-2' : ''}`}>
            {editing && (
              <div className="flex items-center justify-between gap-2 mb-1 px-1">
                <span className="text-[12px] font-semibold text-amber-300">{widgetInfo(id).label}</span>
                <div className="flex items-center gap-1">
                  <IconBtn label={`Move ${widgetInfo(id).label} up`} disabled={i === 0} onClick={() => update({ ...layout, order: moveInOrder(layout.order, id, -1, notShown) })}>
                    <ArrowUp className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn
                    label={`Move ${widgetInfo(id).label} down`}
                    disabled={i === visible.length - 1}
                    onClick={() => update({ ...layout, order: moveInOrder(layout.order, id, 1, notShown) })}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn label={`Minimise ${widgetInfo(id).label}`} onClick={() => minimise(id)}>
                    <Minus className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn label={`Remove ${widgetInfo(id).label}`} onClick={() => remove(id)}>
                    <X className="w-4 h-4" />
                  </IconBtn>
                </div>
              </div>
            )}
            <div className={editing ? 'pointer-events-none opacity-80' : ''}>{render(id, editing)}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const IconBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ label, onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="w-9 h-9 flex items-center justify-center rounded-lg border border-amber-700/60 bg-black/60 text-amber-300 hover:bg-amber-900/40 disabled:opacity-30"
  >
    {children}
  </button>
);
