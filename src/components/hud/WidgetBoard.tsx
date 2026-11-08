// The HUD's widgets. Wide screens: free-floating cards you can move and resize in layout mode.
// Phones / tablets: a stack under the voice screen you can reorder. Hidden widgets, positions
// and order are saved on this device (services/hudLayout.ts).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, EyeOff, Move, Plus, RotateCcw } from 'lucide-react';
import {
  GRID,
  HudLayout,
  Rect,
  Viewport,
  WIDGETS,
  WidgetId,
  clampRect,
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
  hidden: WidgetId[];
  available: WidgetId[];
  wide: boolean;
  onShow: (id: WidgetId) => void;
  onReset: () => void;
  onDone: () => void;
}> = ({ hidden, available, wide, onShow, onReset, onDone }) => {
  const hiddenHere = hidden.filter((id) => available.includes(id));
  return (
    <div
      className={`${wide ? 'fixed bottom-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-32px)]' : 'sticky top-2 mx-3'} z-[60] hud-panel px-3 py-2 flex flex-wrap items-center gap-2 text-[12px] text-amber-200 shadow-[0_0_30px_rgba(245,158,11,0.25)]`}
      role="toolbar"
      aria-label="Edit layout"
    >
      <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
        <Move className="w-3.5 h-3.5" />
        {wide ? 'Drag to move · corner to resize' : 'Reorder or hide widgets'}
      </span>
      {hiddenHere.map((id) => (
        <button
          key={id}
          onClick={() => onShow(id)}
          className="flex items-center gap-1 px-2 py-1 rounded-full border border-amber-700/60 text-amber-300 hover:bg-amber-900/40"
          title={`Show ${widgetInfo(id).label}`}
        >
          <Plus className="w-3 h-3" />
          {widgetInfo(id).label}
        </button>
      ))}
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
};

// ---------------------------------------------------------------------------- Wide: free frame

type DragMode = 'move' | 'resize';

const WidgetFrame: React.FC<{
  id: WidgetId;
  rect: Rect;
  vp: Viewport;
  editing: boolean;
  z: number;
  onCommit: (id: WidgetId, rect: Rect) => void;
  onHide: (id: WidgetId) => void;
  onFocus: (id: WidgetId) => void;
  children: React.ReactNode;
}> = ({ id, rect, vp, editing, z, onCommit, onHide, onFocus, children }) => {
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
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const next =
      d.mode === 'move'
        ? { ...d.start, x: snap(d.start.x + dx), y: snap(d.start.y + dy) }
        : { ...d.start, w: snap(d.start.w + dx), h: snap(d.start.h + dy) };
    setLive(clampRect(next, vp, id));
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
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onHide(id)}
              className="p-1.5 rounded bg-black/80 border border-amber-700/60 text-amber-300 hover:text-amber-100"
              title={`Hide ${label}`}
              aria-label={`Hide ${label}`}
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
          <div
            className="absolute -right-1 -bottom-1 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-1"
            onPointerDown={begin('resize')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            title="Drag to resize"
          >
            <span className="block w-3.5 h-3.5 border-r-[3px] border-b-[3px] border-amber-300 rounded-br" />
          </div>
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

  const hide = (id: WidgetId) => update({ ...layout, hidden: [...layout.hidden.filter((h) => h !== id), id] });
  const show = (id: WidgetId) => update({ ...layout, hidden: layout.hidden.filter((h) => h !== id) });
  const reset = () => {
    update(emptyLayout());
    setFront([]);
  };
  const toFront = (id: WidgetId) => setFront((f) => [...f.filter((x) => x !== id), id]);

  if (wide) {
    const rects = resolveRects(layout, vp);
    const ids = WIDGETS.map((w) => w.id).filter((id) => !layout.hidden.includes(id));
    return (
      <>
        {editing && (
          <EditToolbar
            hidden={layout.hidden}
            available={WIDGETS.map((w) => w.id)}
            wide
            onShow={show}
            onReset={reset}
            onDone={onDoneEditing}
          />
        )}
        {ids.map((id) => (
          <WidgetFrame
            key={id}
            id={id}
            rect={rects[id]}
            vp={vp}
            editing={editing}
            z={20 + Math.max(0, front.indexOf(id) + 1)}
            onCommit={(wid, rect) => update(withRect(layout, vp, wid, rect))}
            onHide={hide}
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
  const visible = mobileIds.filter((id) => !layout.hidden.includes(id));
  return (
    <section className="relative z-20 px-3 pb-8 pb-safe" aria-label="Widgets">
      {/* Peeks out below the voice screen so it's clear there's more to scroll to */}
      <div className="h-10 flex items-center justify-center gap-1.5 text-[11px] font-orbitron tracking-[0.25em] text-amber-500/80">
        <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
        AT A GLANCE
      </div>
      {editing && (
        <EditToolbar hidden={layout.hidden} available={mobileIds} wide={false} onShow={show} onReset={reset} onDone={onDoneEditing} />
      )}
      <div className="mx-auto max-w-xl grid gap-3 mt-1 sm:grid-cols-2 sm:max-w-3xl">
        {visible.map((id, i) => (
          <div key={id} className={`relative hud-widget-stack ${id === 'calendar' || id === 'system' ? 'sm:col-span-2' : ''}`}>
            {editing && (
              <div className="flex items-center justify-between gap-2 mb-1 px-1">
                <span className="text-[12px] font-semibold text-amber-300">{widgetInfo(id).label}</span>
                <div className="flex items-center gap-1">
                  <IconBtn label={`Move ${widgetInfo(id).label} up`} disabled={i === 0} onClick={() => update({ ...layout, order: moveInOrder(layout.order, id, -1, layout.hidden) })}>
                    <ArrowUp className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn
                    label={`Move ${widgetInfo(id).label} down`}
                    disabled={i === visible.length - 1}
                    onClick={() => update({ ...layout, order: moveInOrder(layout.order, id, 1, layout.hidden) })}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn label={`Hide ${widgetInfo(id).label}`} onClick={() => hide(id)}>
                    <EyeOff className="w-4 h-4" />
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
