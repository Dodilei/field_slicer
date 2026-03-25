interface Point { x: number, y: number }
interface Polygon { exterior: Point[] }
interface SlicingResult {
    subfields: Polygon[];
    center_voids: Polygon[];
    radial_slices: Polygon[];
}

let originalPolygon: Polygon | null = null;
let slicedPolygons: Polygon[] = [];
let currentSubfields: Polygon[] = [];
let currentCenterVoids: Polygon[] = [];

export async function setupLogic() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const dropZone = document.getElementById('drop-zone')!;
    const controls = document.getElementById('controls')!;
    const nSlider = document.getElementById('n-slider') as HTMLInputElement;
    const kSlider = document.getElementById('k-slider') as HTMLInputElement;
    const phaseSlider = document.getElementById('phase-slider') as HTMLInputElement;
    const axisSlider = document.getElementById('axis-slider') as HTMLInputElement;
    const snapSlider = document.getElementById('snap-slider') as HTMLInputElement;
    const centerSlider = document.getElementById('center-slider') as HTMLInputElement;
    const valN = document.getElementById('val-n')!;
    const valK = document.getElementById('val-k')!;
    const valPhase = document.getElementById('val-phase')!;
    const valAxis = document.getElementById('val-axis')!;
    const valSnap = document.getElementById('val-snap')!;
    const valCenter = document.getElementById('val-center')!;
    const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
    const pdfBtn = document.getElementById('pdf-btn') as HTMLButtonElement;

    let wasm: any;
    try {
        wasm = await import('core-wasm');
        if (wasm.default) { await wasm.default(); }
    } catch (e) {
        console.warn("WASM module not built yet. The backend won't work until cargo build completes.");
    }

    const resizeCanvas = () => {
        canvas.width = canvas.parentElement!.clientWidth;
        canvas.height = canvas.parentElement!.clientHeight;
        draw(ctx, canvas);
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            if (wasm) {
                try {
                    originalPolygon = wasm.parse_dxf_boundary(bytes);
                } catch (e: any) {
                    alert('Failed to parse DXF Boundary. Is it a closed LwPolyline?');
                    console.error(e);
                    return;
                }
                controls.classList.add('active');
                downloadBtn.disabled = false;
                pdfBtn.disabled = false;
                dropZone.querySelector('div:last-child')!.textContent = file.name;
                
                // Set default center radius to 5% of subfield's equivalent radius
                const area = polyArea(originalPolygon!.exterior);
                const subfieldEqRadius = Math.sqrt((area / parseInt(nSlider.value)) / Math.PI);
                centerSlider.max = (subfieldEqRadius * 0.2).toFixed(2);
                centerSlider.step = getNiceStep(subfieldEqRadius * 0.005).toString();
                centerSlider.value = (subfieldEqRadius * 0.05).toFixed(2);

                try {
                    updateSlices();
                } catch (e: any) {
                    console.error('Initial slicing failed:', e);
                }
            }
        }
    });

    const updateSlices = async () => {
        valN.innerText = nSlider.value;
        valK.innerText = kSlider.value;
        valPhase.innerText = phaseSlider.value + '°';
        valAxis.innerText = axisSlider.value + '°';
        valSnap.innerText = snapSlider.value + '%';
        valCenter.innerText = centerSlider.value + ' m';
        if (!originalPolygon || !wasm) return;
        
        const area = polyArea(originalPolygon.exterior);
        const subfieldEqRadius = Math.sqrt((area / parseInt(nSlider.value)) / Math.PI);
        
        centerSlider.max = (subfieldEqRadius * 0.2).toFixed(2);
        centerSlider.step = getNiceStep(subfieldEqRadius * 0.005).toString();
        
        try {
            const params = {
                n_subfields: parseInt(nSlider.value),
                k_slices: parseInt(kSlider.value),
                pizza_phase: parseFloat(phaseSlider.value) / 360.0,
                axis_rotation: parseFloat(axisSlider.value),
                snap_tolerance: (parseFloat(snapSlider.value) / 100.0) * subfieldEqRadius,
                center_radius: parseFloat(centerSlider.value)
            };
            const result: SlicingResult = wasm.execute_slicing(originalPolygon, params);
            slicedPolygons = result.radial_slices;
            currentSubfields = result.subfields;
            currentCenterVoids = result.center_voids;
            currentN = params.n_subfields;
            currentK = params.k_slices;
            draw(ctx, canvas);
        } catch (e) {
            console.error(e);
        }
    };

    nSlider.addEventListener('input', updateSlices);
    kSlider.addEventListener('input', updateSlices);
    phaseSlider.addEventListener('input', updateSlices);
    axisSlider.addEventListener('input', updateSlices);
    snapSlider.addEventListener('input', updateSlices);
    centerSlider.addEventListener('input', updateSlices);

    downloadBtn.addEventListener('click', () => {
        if (!wasm || slicedPolygons.length === 0) return;
        try {
            const dxfBytes = wasm.export_dxf(slicedPolygons);
            const blob = new Blob([dxfBytes], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sliced_field.dxf';
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
        }
    });

    pdfBtn.addEventListener('click', () => {
        if (!originalPolygon || slicedPolygons.length === 0) return;
        generatePDF(originalPolygon, currentSubfields, currentCenterVoids, slicedPolygons, currentN, currentK);
    });
}

let currentN = 2;
let currentK = 4;

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!originalPolygon && slicedPolygons.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const allPolys = slicedPolygons.length > 0 ? slicedPolygons : [originalPolygon!];
    
    allPolys.forEach(poly => {
        poly.exterior.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
    });

    const padding = 50;
    const sidePanelW = 240;
    const drawAreaW = canvas.width - sidePanelW; // Reserve space for right panel
    const w = maxX - minX;
    const h = maxY - minY;
    
    const scale = Math.min(
        (drawAreaW - padding * 2) / (w || 1),
        (canvas.height - padding * 2) / (h || 1)
    );
    
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const screenCx = drawAreaW / 2;
    const screenCy = canvas.height / 2;

    const toScreen = (x: number, y: number) => ({
        x: (x - cx) * scale + screenCx,
        y: -(y - cy) * scale + screenCy
    });

    if (slicedPolygons.length > 0) {
        slicedPolygons.forEach((poly, i) => {
            ctx.beginPath();
            poly.exterior.forEach((p, j) => {
                const sp = toScreen(p.x, p.y);
                if (j === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
            });
            ctx.closePath();
            
            const hue = (i * 137.5) % 360;
            ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.3)`;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Draw area label inside each radial slice
            const area = polyArea(poly.exterior);
            const centroid = polyCentroid(poly.exterior);
            const sc = toScreen(centroid.x, centroid.y);
            const areaText = formatArea(area);
            ctx.font = '10px Outfit, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(areaText, sc.x, sc.y);
        });
    }

    if (originalPolygon) {
        ctx.beginPath();
        originalPolygon.exterior.forEach((p, j) => {
            const sp = toScreen(p.x, p.y);
            if (j === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw subfield area summary grid in the bottom-right corner
    if (slicedPolygons.length > 0 && currentK >= 1 && currentN >= 1) {
        const n = currentN;
        const k = currentK;
        
        // Group slices into subfields (every k consecutive slices = 1 subfield)
        const subfieldAreas: number[] = [];
        const sliceAreas: number[] = [];
        for (let s = 0; s < n; s++) {
            let sfArea = 0;
            for (let r = 0; r < k; r++) {
                const idx = s * k + r;
                if (idx < slicedPolygons.length) {
                    const a = polyArea(slicedPolygons[idx].exterior);
                    sfArea += a;
                    sliceAreas.push(a);
                }
            }
            subfieldAreas.push(sfArea);
        }
        
        // Calculate metrics
        let maxDeviationStr = "0.0%";
        let devColor = '#22c55e';
        if (sliceAreas.length > 0) {
            const meanArea = sliceAreas.reduce((a, b) => a + b, 0) / sliceAreas.length;
            let maxDev = 0;
            for (const a of sliceAreas) {
                const dev = Math.abs(a - meanArea) / meanArea * 100;
                if (dev > maxDev) maxDev = dev;
            }
            maxDeviationStr = maxDev.toFixed(2) + '%';
            if (maxDev > 5.0) devColor = '#ef4444';
            else if (maxDev > 1.0) devColor = '#eab308';
            else devColor = '#22c55e';
        }

        const totalSum = subfieldAreas.reduce((a, b) => a + b, 0);

        // Glitch Checking
        const originalArea = polyArea(originalPolygon!.exterior);
        let totalVoidArea = 0;
        const centerRadiusStr = (document.getElementById('center-slider') as HTMLInputElement).value;
        const centerRadius = parseFloat(centerRadiusStr);
        if (centerRadius > 0 && k > 2) {
            const voidAreaPerSubfield = (k / 2) * Math.pow(centerRadius, 2) * Math.sin((2 * Math.PI) / k);
            totalVoidArea = voidAreaPerSubfield * n;
        }
        
        const theoreticalTotal = originalArea - totalVoidArea;
        const deviationPct = Math.abs(totalSum - theoreticalTotal) / theoreticalTotal * 100;
        
        let glitchWarning = null;
        if (deviationPct > 0.5) {
            if (totalSum > theoreticalTotal) {
                glitchWarning = `⚠️ WARNING: Slices Overlap (Area Exceeds Match by ${deviationPct.toFixed(1)}%)`;
            } else {
                glitchWarning = `⚠️ WARNING: Missing Area (Slices dropped ${deviationPct.toFixed(1)}%)`;
            }
        }

        // Layout max 3 columns
        let cols = 3;
        if (n === 1) cols = 1;
        else if (n === 2 || n === 4) cols = 2;
        
        const rows = Math.ceil(n / cols);
        
        // Dimensions
        const boxW = Math.max(140, cols * 66 + 16);
        const gridH = rows * 24 + 28;
        
        // Stack layout
        const spacing = 12;
        const totalH = 46;
        const devH = 44;
        const stackHeight = totalH + spacing + devH + spacing + gridH;
        
        // Center the whole stack vertically on the right side
        const sidePanelW = 240;
        const startY = (canvas.height - stackHeight) / 2;
        const totalY = startY;
        const devY = totalY + totalH + spacing;
        const gy = devY + devH + spacing;
        
        // Center horizontally in the side panel area
        const gx = canvas.width - sidePanelW + (sidePanelW - boxW) / 2;
        
        const drawPanel = (y: number, h: number) => {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            roundRect(ctx, gx, y, boxW, h, 8);
        };
        
        // 1. Total Area Box
        drawPanel(totalY, totalH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Total Area', gx + 10, totalY + 8);
        ctx.font = 'bold 16px Outfit, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(formatArea(totalSum), gx + 10, totalY + 22);
        
        // 2. Max Deviation Box
        drawPanel(devY, devH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('Max Deviation', gx + 10, devY + 8);
        ctx.font = 'bold 13px Outfit, sans-serif';
        ctx.fillStyle = devColor;
        ctx.fillText(maxDeviationStr, gx + 10, devY + 22);
        
        // 3. Subfield Areas Box
        drawPanel(gy, gridH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('Subfield Areas', gx + 10, gy + 8);
        
        ctx.font = '11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        const colW = (boxW - 16) / cols;
        for (let idx = 0; idx < subfieldAreas.length; idx++) {
            const col = Math.floor(idx % cols);
            const row = Math.floor(idx / cols);
            const cellX = gx + 8 + (col + 0.5) * colW;
            const cellY = gy + 26 + row * 24;
            ctx.fillStyle = `hsla(${(idx * 137.5) % 360}, 70%, 70%, 0.9)`;
            ctx.fillText(formatArea(subfieldAreas[idx]), cellX, cellY);
        }
        
        // Draw Glitch Warning Banner if necessary
        if (glitchWarning) {
            ctx.font = 'bold 14px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            const textMetrics = ctx.measureText(glitchWarning);
            const bgWidth = textMetrics.width + 32;
            const bgHeight = 32;
            const bgX = (drawAreaW - bgWidth) / 2;
            const bgY = 16;
            
            ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
            ctx.strokeStyle = 'rgba(255, 200, 200, 0.5)';
            ctx.lineWidth = 1;
            roundRect(ctx, bgX, bgY, bgWidth, bgHeight, 6);
            
            ctx.fillStyle = '#ffffff';
            ctx.fillText(glitchWarning, drawAreaW / 2, bgY + 9);
        }
    }
}

function polyArea(pts: Point[]): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
}

function polyCentroid(pts: Point[]): Point {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    const n = pts.length || 1;
    return { x: cx / n, y: cy / n };
}

function formatArea(area: number): string {
    if (area >= 10000) return (area / 10000).toPrecision(3) + ' ha';
    return area.toPrecision(3) + ' m²';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

// ─── PDF Export ─────────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angleBetween(a: Point, b: Point, c: Point): number {
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const m1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
    const m2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);
    if (m1 < 1e-12 || m2 < 1e-12) return Math.PI;
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    return Math.acos(cos);
}

function getNiceStep(raw: number): number {
    if (raw <= 0) return 0.01;
    const pow10 = Math.floor(Math.log10(raw));
    const base = Math.pow(10, pow10);
    const scaled = raw / base;
    if (scaled <= 1) return 1 * base;
    if (scaled <= 2.5) return 2.5 * base; // Added 2.5 for better granularity
    if (scaled <= 5) return 5 * base;
    return 10 * base;
}

function pointOnSegment(p: Point, a: Point, b: Point, tol: number): boolean {
    const ab = dist(a, b);
    const ap = dist(a, p);
    const pb = dist(p, b);
    return Math.abs(ap + pb - ab) < tol;
}

function getEffectiveVertices(pts: Point[]): Point[] {
    // Strip duplicate closing point if present
    let ring = pts;
    if (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 1e-6) {
        ring = ring.slice(0, -1);
    }
    const n = ring.length;
    if (n < 3) return [...ring];
    const result: Point[] = [];
    for (let i = 0; i < n; i++) {
        const prev = ring[(i - 1 + n) % n];
        const curr = ring[i];
        const next = ring[(i + 1) % n];
        const angle = angleBetween(prev, curr, next);
        // Cross product determines convex vs reflex
        const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
        // If reflex (concave vertex), always include it
        // If convex, include only if angle < 150°
        if (cross < 0 || angle < (150 * Math.PI / 180)) {
            result.push(curr);
        }
    }
    return result;
}

function findDivisionEndpoints(boundary: Point[], innerPolygons: Point[][], tol: number): Point[] {
    const pts: Point[] = [];
    for (const inner of innerPolygons) {
        for (const v of inner) {
            for (let i = 0; i < boundary.length; i++) {
                const a = boundary[i];
                const b = boundary[(i + 1) % boundary.length];
                if (pointOnSegment(v, a, b, tol)) {
                    let isDuplicate = false;
                    for (const ep of pts) {
                        if (dist(ep, v) < tol) { isDuplicate = true; break; }
                    }
                    if (!isDuplicate) {
                        // Check it's not just a boundary vertex
                        let isBoundaryVertex = false;
                        for (const bv of boundary) {
                            if (dist(bv, v) < tol) { isBoundaryVertex = true; break; }
                        }
                        if (!isBoundaryVertex) {
                            pts.push(v);
                        }
                    }
                }
            }
        }
    }
    return pts;
}

function orderPointsAlongBoundary(boundary: Point[], points: Point[], tol: number): Point[] {
    // For each point, find the parametric position along the boundary
    const withParam: { pt: Point, t: number }[] = [];
    const segLens: number[] = [];
    for (let i = 0; i < boundary.length; i++) {
        segLens.push(dist(boundary[i], boundary[(i + 1) % boundary.length]));
    }
    
    for (const p of points) {
        let bestT = 0;
        let bestDist = Infinity;
        let runningLen = 0;
        for (let i = 0; i < boundary.length; i++) {
            const a = boundary[i];
            const b = boundary[(i + 1) % boundary.length];
            if (pointOnSegment(p, a, b, tol)) {
                const t = runningLen + dist(a, p);
                const d = Math.min(dist(p, a), dist(p, b));
                if (d < bestDist || (Math.abs(d - bestDist) < tol && t < bestT)) {
                    bestT = t;
                    bestDist = d;
                }
            }
            runningLen += segLens[i];
        }
        withParam.push({ pt: p, t: bestT });
    }
    
    withParam.sort((a, b) => a.t - b.t);
    return withParam.map(wp => wp.pt);
}

function getAnnotationPoints(boundary: Point[], innerPolygons: Point[][]): Point[] {
    const tol = 0.01;
    const effectiveVerts = getEffectiveVertices(boundary);
    const divEndpoints = findDivisionEndpoints(boundary, innerPolygons, tol);
    const allPoints = [...effectiveVerts, ...divEndpoints];
    
    // Deduplicate
    const deduped: Point[] = [];
    for (const p of allPoints) {
        let isDup = false;
        for (const q of deduped) {
            if (dist(p, q) < tol) { isDup = true; break; }
        }
        if (!isDup) deduped.push(p);
    }
    
    return orderPointsAlongBoundary(boundary, deduped, tol);
}

async function generatePDF(
    field: Polygon,
    subfields: Polygon[],
    centerVoids: Polygon[],
    radialSlices: Polygon[],
    n: number,
    k: number,
) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    const drawW = pageW - margin * 2;
    const drawH = pageH - margin * 2 - 15; // reserve 15mm for title

    const colors = [
        '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
        '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    ];

    const drawPolyOnPage = (
        doc: InstanceType<typeof jsPDF>,
        polys: Polygon[],
        boundary: Polygon | null,
        title: string,
        annotationInnerPolys: Point[][],
        annotationBoundary: Point[],
        fillColors?: string[],
        voids?: Polygon[],
        polyNumbers?: number[],
    ) => {
        // Title
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(title, pageW / 2, margin + 4, { align: 'center' });

        // Find bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const allPts = boundary ? boundary.exterior : polys.flatMap(p => p.exterior);
        for (const p of allPts) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        const geoW = maxX - minX || 1;
        const geoH = maxY - minY || 1;
        const scale = Math.min(drawW / geoW, drawH / geoH) * 0.8;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const screenCx = pageW / 2;
        const screenCy = margin + 15 + drawH / 2;

        const toPage = (x: number, y: number) => ({
            x: (x - cx) * scale + screenCx,
            y: -(y - cy) * scale + screenCy,
        });

        // Draw filled polygons
        polys.forEach((poly, i) => {
            const color = fillColors ? fillColors[i % fillColors.length] : colors[i % colors.length];
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);

            doc.setFillColor(r, g, b);
            doc.setDrawColor(80, 80, 80);
            doc.setLineWidth(0.3);

            const points: number[][] = [];
            for (const p of poly.exterior) {
                const sp = toPage(p.x, p.y);
                points.push([sp.x, sp.y]);
            }
            if (points.length > 2) {
                const deltas = [];
                for (let j = 1; j < points.length; j++) {
                    deltas.push([points[j][0] - points[j-1][0], points[j][1] - points[j-1][1]]);
                }
                doc.lines(deltas, points[0][0], points[0][1], [1, 1], 'FD', true);
            }
        });

        // Draw center voids (white filled)
        if (voids) {
            for (const v of voids) {
                doc.setFillColor(255, 255, 255);
                doc.setDrawColor(120, 120, 120);
                doc.setLineWidth(0.2);
                const points: number[][] = [];
                for (const p of v.exterior) {
                    const sp = toPage(p.x, p.y);
                    points.push([sp.x, sp.y]);
                }
                if (points.length > 2) {
                    const deltas = [];
                    for (let j = 1; j < points.length; j++) {
                        deltas.push([points[j][0] - points[j-1][0], points[j][1] - points[j-1][1]]);
                    }
                    doc.lines(deltas, points[0][0], points[0][1], [1, 1], 'FD', true);
                }
            }
        }

        // Draw boundary outline
        if (boundary) {
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.5);
            for (let i = 0; i < boundary.exterior.length; i++) {
                const a = toPage(boundary.exterior[i].x, boundary.exterior[i].y);
                const b = toPage(boundary.exterior[(i + 1) % boundary.exterior.length].x,
                                  boundary.exterior[(i + 1) % boundary.exterior.length].y);
                doc.line(a.x, a.y, b.x, b.y);
            }
        }

        // Annotate distances along boundary
        const annotPts = getAnnotationPoints(annotationBoundary, annotationInnerPolys);
        if (annotPts.length >= 2) {
            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(30, 60, 180);

            for (let i = 0; i < annotPts.length; i++) {
                const a = annotPts[i];
                const b = annotPts[(i + 1) % annotPts.length];
                const d = dist(a, b);
                if (d < 0.01) continue;

                const midGeo = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const sp = toPage(midGeo.x, midGeo.y);

                // Offset label outward from boundary centroid
                const boundaryCentroid = polyCentroid(annotationBoundary);
                const dx = midGeo.x - boundaryCentroid.x;
                const dy = midGeo.y - boundaryCentroid.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const offsetPx = 10;
                sp.x += (dx / len) * offsetPx;
                sp.y -= (dy / len) * offsetPx;

                const label = d.toPrecision(3) + ' m';
                const tw = doc.getTextWidth(label);
                const th = 4.5;
                doc.setFillColor(255, 255, 255);
                doc.setGState(new (doc as any).GState({ opacity: 0.75 }));
                doc.roundedRect(sp.x - tw / 2 - 1, sp.y - th + 0.5, tw + 2, th + 1, 0.8, 0.8, 'F');
                doc.setGState(new (doc as any).GState({ opacity: 1 }));
                doc.setTextColor(30, 60, 180);
                doc.text(label, sp.x, sp.y, { align: 'center' });
            }

            // Draw annotation points as small dots
            doc.setFillColor(200, 30, 30);
            for (const p of annotPts) {
                const sp = toPage(p.x, p.y);
                doc.circle(sp.x, sp.y, 0.5, 'F');
            }
        }

        // Draw area labels
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        for (let i = 0; i < polys.length; i++) {
            const poly = polys[i];
            const area = polyArea(poly.exterior);
            const c = polyCentroid(poly.exterior);
            const sp = toPage(c.x, c.y);
            
            if (polyNumbers && polyNumbers[i] !== undefined) {
                // Draw number label above area
                const numLabel = '#' + polyNumbers[i];
                doc.setFontSize(18);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(numLabel, sp.x, sp.y - 4, { align: 'center' });
                
                // Draw area below
                doc.setFontSize(14);
                doc.setFont('helvetica', 'normal');
                doc.text(formatArea(area), sp.x, sp.y + 4, { align: 'center' });
            } else {
                doc.text(formatArea(area), sp.x, sp.y, { align: 'center' });
            }
        }
    };

    // ─── Page 1: Main field with subfields ──────────────────────
    const sfColors = subfields.map((_, i) => {
        const hue = (i * 137.5) % 360;
        const h = hue / 360;
        // HSL to hex (s=0.5, l=0.65)
        const s = 0.5, l = 0.65;
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        const g = Math.round(hue2rgb(p, q, h) * 255);
        const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    });

    const sfNumbers = subfields.map((_, i) => i + 1);
    const innerPolysPage1 = subfields.map(sf => sf.exterior);
    drawPolyOnPage(
        doc, subfields, field,
        'Field Overview — Subfield Divisions',
        innerPolysPage1, field.exterior,
        sfColors, centerVoids, sfNumbers
    );

    // ─── Pages 2..N+1: Individual subfields with radial slices ──
    for (let s = 0; s < n; s++) {
        doc.addPage();
        const sf = subfields[s];
        const sfSlices = radialSlices.slice(s * k, s * k + k);
        const sfVoids = s < centerVoids.length ? [centerVoids[s]] : [];

        const sliceColors = sfSlices.map((_, i) => {
            const hue = (i * 137.5 + s * 60) % 360;
            const h = hue / 360;
            const ss = 0.6, l = 0.6;
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1; if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + ss) : l + ss - l * ss;
            const p = 2 * l - q;
            const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
            const g = Math.round(hue2rgb(p, q, h) * 255);
            const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
            return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
        });

        const innerPolys = sfSlices.map(sl => sl.exterior);
        drawPolyOnPage(
            doc, sfSlices, sf,
            `Subfield #${s + 1} of ${n} — Radial Slices`,
            innerPolys, sf.exterior,
            sliceColors, sfVoids
        );
    }

    doc.save('field_slicing_report.pdf');
}
