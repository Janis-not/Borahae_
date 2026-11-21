// Borahae · Tokens: the plan's usage windows (5 h / weekly), how long until each
// resets, and the context window, above Spaces in the sidebar.
// The figures come from a Claude Code mod or status line script, which writes them to
// ~/.claude/borahae-usage.json after every response and once a minute.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, home } from "herdr";

const PURPLE = "#a374db";
const LILAC = "#d6b4fc";
const SOFT = "#cdb8ea";
const MUTED = "#9c86b8";
const TRACK = "#3a2a50";
const CARD = "#2a1545";
const EDGE = "#4a2d6e";
const HEART = "mods/borahae-tokens/heart.png";

const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function untilText(ms) {
  if (ms <= 0) return "ya se restableció";
  const min = Math.ceil(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function atText(when, now) {
  const hm = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return when.toDateString() === now.toDateString() ? hm : `${DAYS[when.getDay()]} ${when.getDate()} · ${hm}`;
}

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

const fill = (pct) => (pct >= 90 ? "#ff6b81" : pct >= 75 ? "#ffd166" : PURPLE);

export default class BorahaeTokens extends View {
  init(_props, cx) {
    this.data = null;
    this.now = Date.now();
    this.width = 240;
    this.path = home().replace(/\\/g, "/") + "/.claude/borahae-usage.json";
    this.load(cx);
    // Data, not animation: the file changes at most once a response; the
    // countdown moves by the minute.
    cx.timer.every(20000, (cx) => this.load(cx));
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.path);
        this.data = text ? JSON.parse(text) : null;
      } catch {
        this.data = null;
      }
      this.now = Date.now();
      cx.notify();
    });
  }

  bar(pct, w) {
    const inner = Math.max(0, Math.min(100, pct));
    return div().h(6).w(w).rounded(3).bg(TRACK)
      .child(div().h(6).w(Math.max(inner > 0 ? 3 : 0, Math.round((w * inner) / 100))).rounded(3).bg(fill(pct)));
  }

  limit(r, w, now) {
    const used = Number(r.percentUsed) || 0;
    const left = Math.max(0, 100 - used);
    const resets = r.resetsAt ? new Date(Date.parse(r.resetsAt)) : null;
    return v_flex().gap(3)
      .child(h_flex().justify_between()
        .child(div().text_size(12).font_semibold().text_color(SOFT).child(r.label || r.kind))
        .child(div().text_size(12).font_semibold().text_color(fill(used)).child(`${used}%`)))
      .child(this.bar(used, w))
      .child(h_flex().justify_between()
        .child(div().text_size(11).text_color(LILAC).child(`♡ quedan ${left.toFixed(left % 1 ? 1 : 0)}%`))
        .child(div().text_size(11).text_color(MUTED).child(
          resets ? `⏳ ${untilText(resets.getTime() - now.getTime())} · ${atText(resets, now)}` : "")));
  }

  render(cx) {
    const now = new Date(this.now);
    const w = Math.max(120, this.width - 40);
    const d = this.data;

    const header = h_flex().items_center().gap(6)
      .child(image(HEART).w(13).h(13).loop("opacity", { from: 0.45, to: 1, period: 1400 }))
      .child(div().text_size(12).font_semibold().text_color(PURPLE).child("TOKENS"))
      .child(div().text_size(11).text_color(MUTED).child("· borahae"));

    let body;
    if (!d) {
      body = div().text_size(11).text_color(MUTED)
        .child("Aún sin datos. Aparecen tras la primera respuesta de Claude (ver RECIPE.md).");
    } else {
      const parts = [];
      for (const r of d.rateLimits || []) parts.push(this.limit(r, w, now));
      if (parts.length === 0) {
        parts.push(div().text_size(11).text_color(MUTED).child("Límites del plan: aún sin lectura."));
      }
      const c = d.context || {};
      if (c.tokens != null && c.window) {
        const pct = c.percent != null ? c.percent : Math.round((c.tokens / c.window) * 100);
        parts.push(h_flex().justify_between()
          .child(div().text_size(11).text_color(SOFT).child("Contexto"))
          .child(div().text_size(11).text_color(MUTED)
            .child(`${fmtTokens(c.tokens)} / ${fmtTokens(c.window)} · ${pct}%`)));
      }
      body = v_flex().gap(8).children(parts);
    }

    return v_flex().id("borahae-tokens-root").size_full().px(10).py(8)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(v_flex().gap(8).p(10).rounded(10).bg(CARD).border(1).border_color(EDGE)
        .child(header)
        .child(body));
  }
}
