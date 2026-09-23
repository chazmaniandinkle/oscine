// Toolbar: the editing tools, in one row under the transport. Every button
// is an action from the keymap, so the tooltip shows the live binding and
// a scheme change relabels it. Edit group / snap group / view group.
import { el, Select } from './widgets.js';
import { keymap } from '../core/keymap.js';

export class Toolbar {
  constructor(host, app) {
    this.app = app; this.store = app.store; this.host = host;
    host.className = 'toolbar';
    this.buttons = new Map(); // action -> button

    const group = (cls) => { const g = el('div', 'tb-tools ' + (cls || '')); host.appendChild(g); return g; };
    const btn = (g, action, label, { needs = null, title = null } = {}) => {
      const b = el('button', 'btn mini tool-btn', label);
      b.type = 'button'; b.dataset.action = action;
      b.addEventListener('click', () => app.runAction(action));
      b._needs = needs; b._title = title || keymap.actionLabel(action);
      g.appendChild(b); this.buttons.set(action, b);
      return b;
    };

    // -- edit
    const edit = group('tb-edit');
    btn(edit, 'edit.undo', '↶', { title: 'Undo' });
    btn(edit, 'edit.redo', '↷', { title: 'Redo' });
    edit.appendChild(el('span', 'tb-sep'));
    btn(edit, 'clip.split', 'Split', { needs: 'clip', title: 'Split at playhead (or at range edges)' });
    btn(edit, 'clip.delete', 'Remove', { needs: 'clip', title: 'Remove clip (or cut the range slice)' });
    btn(edit, 'range.rippleDelete', 'Ripple', { needs: 'range', title: 'Cut the range from every lane and close the gap' });
    btn(edit, 'range.clear', 'Clear range', { needs: 'range' });
    edit.appendChild(el('span', 'tb-sep'));
    btn(edit, 'clip.pitchDown', '♭', { needs: 'clip', title: 'Pitch −1 semitone' });
    btn(edit, 'clip.pitchUp', '♯', { needs: 'clip', title: 'Pitch +1 semitone' });
    btn(edit, 'clip.gainDown', '−dB', { needs: 'clip', title: 'Clip gain −1 dB' });
    btn(edit, 'clip.gainUp', '+dB', { needs: 'clip', title: 'Clip gain +1 dB' });

    // -- snap
    const snap = group('tb-snap');
    this.snapBtn = btn(snap, 'snap.toggle', 'Snap', { title: 'Snap on/off' });
    this.snapSel = Select({
      options: [{ value: 0, label: 'Off' }, { value: 0.25, label: '1/16' }, { value: 0.5, label: '1/8' }, { value: 1, label: 'Beat' }, { value: 4, label: 'Bar' }],
      value: this.store.ui.snap,
      onChange: v => { this.store.ui.snap = Number(v); this.app.timeline.dirty = true; },
    });
    this.snapSel.root.classList.add('snap-ctl');
    this.snapSel.root.title = 'Grid division for snap (clip edges / playhead / range edges always snap when on)';
    snap.appendChild(this.snapSel.root);

    // -- view
    const view = group('tb-view');
    btn(view, 'view.fit', 'Fit', { title: 'Fit song to width' });
    btn(view, 'view.zoomIn', '+', { title: 'Zoom in' });
    btn(view, 'view.zoomOut', '−', { title: 'Zoom out' });
    this.followBtn = btn(view, 'view.follow', 'Follow', { title: 'Follow playhead during playback' });
    this.lyricsBtn = btn(view, 'view.lyrics', 'Lyrics', { title: 'Show the lyrics bar' });

    // -- scheme (right)
    const right = group('tb-right');
    this.schemeSel = Select({
      label: 'Keys',
      options: keymap.schemes().map(s => ({ value: s.id, label: s.label })),
      value: keymap.scheme,
      onChange: v => { keymap.use(v); this.relabel(); app.bus.emit('keymap:changed', {}); },
    });
    right.appendChild(this.schemeSel.root);

    const { bus } = app;
    for (const t of ['clip:selected', 'lane:selected', 'asset:selected', 'overlap:selected', 'project:replaced', 'range:changed', 'ui:snap', 'ui:view', 'keymap:changed']) bus.on(t, () => this.refresh());
    this.relabel(); this.refresh();
  }
  relabel() {
    for (const [action, b] of this.buttons) {
      const k = keymap.label(action);
      b.title = b._title + (k ? `  (${k})` : '');
    }
  }
  refresh() {
    const tl = this.app.timeline, st = this.store;
    const hasClip = tl?.active && (tl.selected != null || tl.multi?.length);
    const hasRange = tl?.active && !!tl.range;
    for (const [, b] of this.buttons) {
      const ok = b._needs === 'clip' ? hasClip : b._needs === 'range' ? hasRange : true;
      b.disabled = !ok;
    }
    this.buttons.get('edit.undo').disabled = !st.canUndo;
    this.buttons.get('edit.redo').disabled = !st.canRedo;
    this.snapBtn.classList.toggle('on-accent', st.ui.snapOn !== false);
    this.snapSel.set?.(st.ui.snap);
    this.followBtn.classList.toggle('on-accent', st.ui.follow !== false);
    this.lyricsBtn.classList.toggle('on-accent', st.ui.lyrics !== false);
  }
}
