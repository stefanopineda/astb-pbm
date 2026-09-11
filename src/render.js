export function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, Math.floor(rect.width * dpr));
  const h = Math.max(240, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawAircraft(ctx, x, y, heading, scale, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#3a2e00";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(4, -6);
  ctx.lineTo(16, 2);
  ctx.lineTo(4, 0);
  ctx.lineTo(3, 14);
  ctx.lineTo(8, 18);
  ctx.lineTo(0, 15);
  ctx.lineTo(-8, 18);
  ctx.lineTo(-3, 14);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-16, 2);
  ctx.lineTo(-4, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCross(ctx, x, y, on, size = 16) {
  ctx.save();
  ctx.strokeStyle = on ? "#7CFF6B" : "#ff3b30";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  if (on) {
    ctx.strokeStyle = "rgba(124,255,107,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBracket(ctx, y, x0, x1, on) {
  ctx.save();
  ctx.strokeStyle = on ? "#7CFF6B" : "#ff3b30";
  ctx.lineWidth = 3;
  const h = 14;
  ctx.beginPath();
  ctx.moveTo(x0, y - h);
  ctx.lineTo(x0, y + h);
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x1, y - h);
  ctx.lineTo(x1, y + h);
  ctx.stroke();
  ctx.restore();
}

function grid(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(180, 210, 255, 0.05)";
  ctx.lineWidth = 1;
  const step = 40;
  for (let gx = x; gx <= x + w; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + h; gy += step) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
  ctx.restore();
}

export function layoutFor(mode, w, h) {
  const pad = 18;
  const showVtt = mode === "vtt" || mode === "avtt" || mode === "multi" || mode === "emergency";
  const showAtt = mode === "att" || mode === "avtt" || mode === "multi" || mode === "emergency";
  const showDlt = mode === "dlt" || mode === "multi" || mode === "emergency";
  let vtt = null;
  let att = null;
  if (showVtt && showAtt) {
    const lane = Math.max(120, Math.floor(w * 0.18));
    vtt = { x: pad, y: pad, w: lane, h: h - pad * 2 };
    att = { x: pad + lane + 12, y: pad, w: w - (pad + lane + 12) - pad, h: h - pad * 2 };
  } else if (showVtt) {
    const lane = Math.min(300, Math.floor(w * 0.34));
    vtt = { x: Math.floor((w - lane) / 2), y: pad, w: lane, h: h - pad * 2 };
  } else if (showAtt) {
    att = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };
  }
  return { vtt, att, showDlt, pad };
}

export function drawFrame(ctx, world) {
  const { w, h, mode, vttTarget, attTarget, vttReticle, attReticle, vttOn, attOn, dlt } = world;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, w, h);

  const lay = layoutFor(mode, w, h);

  if (lay.vtt) {
    const b = lay.vtt;
    ctx.fillStyle = "#0d1522";
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,176,0,0.25)";
    ctx.stroke();
    grid(ctx, b.x, b.y, b.w, b.h);
    ctx.fillStyle = "#ffb000";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("VTT  THROTTLE", b.x + 10, b.y + 16);
    if (vttTarget) {
      drawAircraft(ctx, b.x + b.w / 2, vttTarget.y, vttTarget.heading, 1.15, "#f5c518");
    }
    if (vttReticle) {
      drawBracket(ctx, vttReticle.y, b.x + 18, b.x + b.w - 18, vttOn);
    }
  }

  if (lay.att) {
    const b = lay.att;
    ctx.fillStyle = "#0d1522";
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(74,163,255,0.28)";
    ctx.stroke();
    grid(ctx, b.x, b.y, b.w, b.h);
    ctx.fillStyle = "#8ec2ff";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("ATT  STICK  ·  Y INVERTED", b.x + 10, b.y + 16);
    if (attTarget) {
      drawAircraft(ctx, attTarget.x, attTarget.y, attTarget.heading, 1.2, "#f5c518");
    }
    if (attReticle) {
      drawCross(ctx, attReticle.x, attReticle.y, attOn, 18);
    }
  }

  if (mode === "dlt") {
    drawDltStage(ctx, w, h, dlt);
  }
}

function drawDltStage(ctx, w, h, dlt) {
  const cx = w / 2;
  const cy = h / 2;
  earCard(ctx, cx - 220, cy - 90, 180, 180, "LEFT", dlt?.left, dlt?.ear === "L");
  earCard(ctx, cx + 40, cy - 90, 180, 180, "RIGHT", dlt?.right, dlt?.ear === "R");
  ctx.fillStyle = "#d6deea";
  ctx.font = "600 16px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(dlt?.ear === "L" ? "ATTEND LEFT EAR" : "ATTEND RIGHT EAR", cx, cy + 130);
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillStyle = "#7d8a9a";
  ctx.fillText("even → STICK trigger     odd → THROTTLE thumb     letters → ignore", cx, cy + 154);
  ctx.textAlign = "left";
}

function earCard(ctx, x, y, w, h, label, token, active) {
  ctx.save();
  ctx.fillStyle = active ? "#132238" : "#0d1522";
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = active ? "#ffb000" : "rgba(255,255,255,0.08)";
  ctx.lineWidth = active ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = "#7d8a9a";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(label, x + 16, y + 22);
  ctx.fillStyle = active ? "#f5c518" : "#d6deea";
  ctx.font = "700 56px ui-sans-serif, system-ui";
  ctx.fillText(token || "·", x + 16, y + 100);
  ctx.restore();
}

export function worldFromState(state, canvasSize) {
  return {
    w: canvasSize.w,
    h: canvasSize.h,
    mode: state.mode,
    vttTarget: state.vttTarget,
    attTarget: state.attTarget,
    vttReticle: state.vttReticle,
    attReticle: state.attReticle,
    vttOn: state.vttOn,
    attOn: state.attOn,
    dlt: state.dltLive,
  };
}
