use crate::geometry::{WasmPolygon, WasmPoint};
use geo::{Polygon, MultiPolygon, Rect, Coord, Area, BoundingRect, Point, Centroid, LineString};
use geo::BooleanOps;
use std::f64::consts::PI;

pub fn slice(
    polygon: &WasmPolygon,
    n_subfields: usize,
    k_slices: usize,
    pizza_phase: f64,
    axis_rotation_deg: f64,
    snap_tolerance: f64,
    center_radius: f64
) -> Result<crate::SlicingResult, String> {
    let ext: Vec<Coord<f64>> = polygon.exterior.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
    if ext.is_empty() { 
        return Ok(crate::SlicingResult { subfields: vec![], center_voids: vec![], radial_slices: vec![] }); 
    }
    let geo_poly = Polygon::new(LineString::new(ext), vec![]);
    
    let subfields = grid_slice(&geo_poly, n_subfields, axis_rotation_deg);
    
    let (all_slices, all_voids) = radial_slice_with_snap(&subfields, k_slices, pizza_phase, snap_tolerance, center_radius);
    
    Ok(crate::SlicingResult {
        subfields: subfields.into_iter().map(geo_to_wasm).collect(),
        center_voids: all_voids.into_iter().map(geo_to_wasm).collect(),
        radial_slices: all_slices.into_iter().map(geo_to_wasm).collect()
    })
}

// ─── Grid Slicing (unchanged) ──────────────────────────────────────────

fn is_prime(num: usize) -> bool {
    if num <= 1 { return false; }
    if num <= 3 { return true; }
    if num % 2 == 0 || num % 3 == 0 { return false; }
    let mut i = 5;
    while i * i <= num {
        if num % i == 0 || num % (i + 2) == 0 { return false; }
        i += 6;
    }
    true
}

fn grid_slice(poly: &Polygon<f64>, n: usize, axis_rotation_deg: f64) -> Vec<Polygon<f64>> {
    if n <= 1 {
        return vec![poly.clone()];
    }
    
    let coords = &poly.exterior().0;
    let mut max_dist_sq = 0.0;
    let mut best_pair = (coords[0], coords[0]);
    for i in 0..coords.len() {
        for j in i+1..coords.len() {
            let dx = coords[j].x - coords[i].x;
            let dy = coords[j].y - coords[i].y;
            let d_sq = dx*dx + dy*dy;
            if d_sq > max_dist_sq {
                max_dist_sq = d_sq;
                best_pair = (coords[i], coords[j]);
            }
        }
    }
    
    let dx = best_pair.1.x - best_pair.0.x;
    let dy = best_pair.1.y - best_pair.0.y;
    let theta = dy.atan2(dx) + 0.25 * PI + axis_rotation_deg * PI / 180.0;
    
    let rot_poly = rotate_polygon(poly, -theta);
    
    let bbox = rot_poly.bounding_rect().unwrap_or(Rect::new(Coord{x:0.,y:0.}, Coord{x:1.,y:1.}));
    let width = bbox.max().x - bbox.min().x;
    let height = bbox.max().y - bbox.min().y;
    let ar = if height > 0.0001 { width / height } else { 1.0 };
    
    let mut best_a = 1;
    let mut best_b = n;
    
    if is_prime(n) {
        best_a = n;
        best_b = 1;
    } else {
        let mut min_ar_diff = f64::MAX;
        for a in 1..=n {
            if n % a == 0 {
                let b = n / a;
                let current_ar = a as f64 / b as f64;
                let diff = (current_ar - ar).abs();
                if diff < min_ar_diff {
                    min_ar_diff = diff;
                    best_a = a;
                    best_b = b;
                }
            }
        }
    }
    
    let a = best_a;
    let b = best_b;
    
    let total_area = rot_poly.unsigned_area();
    let min_x = bbox.min().x;
    let max_x = bbox.max().x;
    let min_y = bbox.min().y - 10.0 * (height + 1.0);
    let max_y = bbox.max().y + 10.0 * (height + 1.0);
    
    let mut x_cuts = vec![min_x];
    for i in 1..a {
        let target = total_area * (i as f64) / (a as f64);
        let mut low = *x_cuts.last().unwrap();
        let mut high = max_x;
        let mut best_cut = max_x;
        
        for _ in 0..40 {
            let mid = (low + high) / 2.0;
            let clip_poly = make_rect(min_x - 1.0, min_y, mid, max_y);
            let intersect = rot_poly.intersection(&clip_poly);
            let sa = intersect.unsigned_area();
            if sa < target { low = mid; } else { high = mid; }
            best_cut = mid;
        }
        x_cuts.push(best_cut);
    }
    x_cuts.push(max_x);
    
    let xc = (min_x + max_x) / 2.0;
    
    let m_bottom = 0.0;
    let k_bottom = min_y;
    let m_top = 0.0;
    let k_top = max_y;
    
    let mut lines = vec![(m_bottom, k_bottom)];
    
    for j in 1..b {
        let global_target = total_area * (j as f64) / (b as f64);
        
        let mut best_m = 0.0;
        let mut best_k = 0.0;
        let mut min_error = f64::MAX;
        
        for angle_deg in -20..=20 {
            let angle = (angle_deg as f64) * PI / 180.0;
            let m = angle.tan();
            
            let mut k_low = bbox.min().y - 2.0 * height;
            let mut k_high = bbox.max().y + 2.0 * height;
            let mut current_k = k_low;
            
            for _ in 0..40 {
                let k_mid = (k_low + k_high) / 2.0;
                let clip_poly = make_half_plane_below(m, k_mid, xc, min_x - 1.0, max_x + 1.0, min_y - 1.0);
                let intersect = rot_poly.intersection(&clip_poly);
                let sa = intersect.unsigned_area();
                
                if sa < global_target {
                    k_low = k_mid;
                } else {
                    k_high = k_mid;
                }
                current_k = k_mid;
            }
            
            let clip_poly = make_half_plane_below(m, current_k, xc, min_x - 1.0, max_x + 1.0, min_y - 1.0);
            let intersect_all = rot_poly.intersection(&clip_poly);
            
            let mut error = 0.0;
            let target_strip_below = (total_area / (a as f64 * b as f64)) * (j as f64);
            
            for i in 0..a {
                let strip_rect = make_rect(x_cuts[i], min_y, x_cuts[i+1], max_y);
                let strip_mp = MultiPolygon(vec![strip_rect]);
                let strip_intersect = intersect_all.intersection(&strip_mp);
                let sa = strip_intersect.unsigned_area();
                let diff = sa - target_strip_below;
                error += diff * diff;
            }
            
            if error < min_error {
                min_error = error;
                best_m = m;
                best_k = current_k;
            }
        }
        lines.push((best_m, best_k));
    }
    lines.push((m_top, k_top));
    
    let mut slices = Vec::new();
    for i in 0..a {
        for j in 0..b {
            let x0 = x_cuts[i];
            let x1 = x_cuts[i+1];
            let (m0, k0) = lines[j];
            let (m1, k1) = lines[j+1];
            
            let cell_poly = Polygon::new(LineString::from(vec![
                (x0, m0 * (x0 - xc) + k0),
                (x1, m0 * (x1 - xc) + k0),
                (x1, m1 * (x1 - xc) + k1),
                (x0, m1 * (x0 - xc) + k1),
                (x0, m0 * (x0 - xc) + k0),
            ]), vec![]);
            
            let intersect = rot_poly.intersection(&cell_poly);
            if let Some(p) = get_largest_polygon(&intersect) {
                let p_orig = rotate_polygon(&p, theta);
                slices.push(p_orig);
            }
        }
    }
    
    slices
}

// ─── Radial Slicing with Shared Boundary Snapping ──────────────────────

/// For each subfield, compute equal-area radial slices (binary search angles).
/// Then snap radial ray endpoints on shared boundaries between neighboring subfields.
fn radial_slice_with_snap(
    subfields: &[Polygon<f64>],
    k: usize,
    phase: f64,
    snap_tolerance: f64,
    center_radius: f64,
) -> (Vec<Polygon<f64>>, Vec<Polygon<f64>>) {
    if k <= 1 {
        return (subfields.to_vec(), vec![]);
    }
    
    let mut all_ray_angles: Vec<Vec<f64>> = Vec::new();
    let mut all_centroids: Vec<Point<f64>> = Vec::new();
    let mut all_boundary_points: Vec<Vec<Coord<f64>>> = Vec::new();
    let mut all_v_pts: Vec<Vec<Coord<f64>>> = Vec::new();
    
    for sf in subfields {
        let centroid = sf.centroid().unwrap_or(Point::new(0., 0.));
        all_centroids.push(centroid);
        
        let bbox = sf.bounding_rect().unwrap_or(Rect::new(Coord{x:0.,y:0.}, Coord{x:1.,y:1.}));
        let r = ((bbox.max().x - bbox.min().x).powi(2) + (bbox.max().y - bbox.min().y).powi(2)).sqrt() * 2.0;
        
        let use_void = center_radius > 0.0 && k > 1;
        let void_radius = if use_void {
            center_radius
        } else {
            0.0
        };
        
        // Vertices of the regular K-gon
        let mut v_pts = Vec::new();
        for i in 0..k {
            let phi = phase * 2.0 * PI + (i as f64) * 2.0 * PI / (k as f64);
            v_pts.push(Coord {
                x: centroid.x() + void_radius * phi.cos(),
                y: centroid.y() + void_radius * phi.sin(),
            });
        }
        all_v_pts.push(v_pts.clone());
        
        let void_area = if use_void && k > 2 {
            let mut void_coords = v_pts.clone();
            void_coords.push(v_pts[0]);
            Polygon::new(LineString::from(void_coords), vec![]).unsigned_area()
        } else {
            0.0
        };
        
        let target_area = (sf.unsigned_area() - void_area) / k as f64;
        
        let mut angles = Vec::new();
        let mut boundary_pts = Vec::new();
        let mut current_angle = phase * 2.0 * PI;
        
        angles.push(current_angle);
        boundary_pts.push(ray_boundary_intersection_from_point(v_pts[0], current_angle, r, sf));
        
        for i in 1..k {
            let mut min_theta = current_angle;
            let mut max_theta = current_angle + 2.0 * PI;
            let v_start = v_pts[i - 1];
            let v_end = v_pts[i];
            
            for _ in 0..40 {
                let mid_theta = (min_theta + max_theta) / 2.0;
                let wedge = create_search_wedge(centroid, r, current_angle, mid_theta, v_start, v_end);
                let intersect = sf.intersection(&wedge);
                let area = intersect.unsigned_area();
                if area < target_area {
                    min_theta = mid_theta;
                } else {
                    max_theta = mid_theta;
                }
            }
            current_angle = (min_theta + max_theta) / 2.0;
            angles.push(current_angle);
            boundary_pts.push(ray_boundary_intersection_from_point(v_pts[i], current_angle, r, sf));
        }
        
        all_ray_angles.push(angles);
        all_boundary_points.push(boundary_pts);
    }
    
    // Step 1.5: Snap boundary points to subfield/boundary vertices
    if snap_tolerance > 0.0 {
        let tol_sq = snap_tolerance * snap_tolerance;
        for i in 0..subfields.len() {
            for pi in 0..all_boundary_points[i].len() {
                let a = all_boundary_points[i][pi];
                let mut best_dist = tol_sq;
                let mut best_vertex = None;
                
                for sf in subfields {
                    for v in &sf.exterior().0 {
                        let dx = a.x - v.x;
                        let dy = a.y - v.y;
                        let d_sq = dx*dx + dy*dy;
                        if d_sq < best_dist && d_sq > 1e-12 {
                            best_dist = d_sq;
                            best_vertex = Some(*v);
                        }
                    }
                }
                
                if let Some(v) = best_vertex {
                    all_boundary_points[i][pi] = v;
                }
            }
        }
    }
    
    // Step 2: Snap boundary points between neighboring subfields

    if snap_tolerance > 0.0 {
        let tol_sq = snap_tolerance * snap_tolerance;
        for i in 0..subfields.len() {
            for j in (i+1)..subfields.len() {
                if !subfields_share_boundary(&subfields[i], &subfields[j], snap_tolerance * 5.0) {
                    continue;
                }
                for pi in 0..all_boundary_points[i].len() {
                    for pj in 0..all_boundary_points[j].len() {
                        let a = all_boundary_points[i][pi];
                        let b = all_boundary_points[j][pj];
                        let dx = a.x - b.x;
                        let dy = a.y - b.y;
                        if dx*dx + dy*dy < tol_sq {
                            let avg = Coord { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
                            all_boundary_points[i][pi] = avg;
                            all_boundary_points[j][pj] = avg;
                        }
                    }
                }
            }
        }
    }
    
    // Step 3: Rebuild radial slices using the (possibly snapped) boundary points
    let mut result = Vec::new();
    let mut center_polys = Vec::new();
    for (sf_idx, sf) in subfields.iter().enumerate() {
        let centroid = all_centroids[sf_idx];
        let angles = &all_ray_angles[sf_idx];
        let bnd_pts = &all_boundary_points[sf_idx];
        let v_pts = &all_v_pts[sf_idx];
        
        let bbox = sf.bounding_rect().unwrap_or(Rect::new(Coord{x:0.,y:0.}, Coord{x:1.,y:1.}));
        let r = ((bbox.max().x - bbox.min().x).powi(2) + (bbox.max().y - bbox.min().y).powi(2)).sqrt() * 2.0;
        let use_void = center_radius > 0.0 && k > 1;
        
        if use_void && k > 2 {
            let mut void_coords = v_pts.clone();
            void_coords.push(v_pts[0]);
            center_polys.push(Polygon::new(LineString::from(void_coords), vec![]));
        }
        
        for slice_idx in 0..k {
            let angle_start = angles[slice_idx];
            let angle_end = if slice_idx + 1 < k { angles[slice_idx + 1] } else { angles[0] + 2.0 * PI };
            let end_idx = if slice_idx + 1 < k { slice_idx + 1 } else { 0 };
            
            let centroid_coord = Coord { x: centroid.x(), y: centroid.y() };
            
            let wedge = if use_void {
                create_wedge_with_void(
                    centroid, r, 0.0,
                    angle_start, angle_end,
                    bnd_pts[slice_idx], bnd_pts[end_idx],
                    *v_pts.get(slice_idx).unwrap_or(&centroid_coord),
                    *v_pts.get(end_idx).unwrap_or(&centroid_coord),
                )
            } else {
                create_wedge_with_endpoints(
                    centroid, r,
                    angle_start, angle_end,
                    bnd_pts[slice_idx], bnd_pts[end_idx],
                )
            };
            
            let intersect = sf.intersection(&wedge);
            if let Some(p) = get_largest_polygon(&intersect) {
                result.push(p);
            }
        }
    }
    
    (result, center_polys)
}

fn ray_boundary_intersection_from_point(start: Coord<f64>, theta: f64, r: f64, poly: &Polygon<f64>) -> Coord<f64> {
    let far = Coord {
        x: start.x + r * theta.cos(),
        y: start.y + r * theta.sin(),
    };
    
    let coords = &poly.exterior().0;
    let mut best_t = f64::MAX;
    let mut best_point = far;
    
    for i in 0..coords.len().saturating_sub(1) {
        let p1 = coords[i];
        let p2 = coords[i + 1];
        
        if let Some((t, pt)) = ray_segment_intersection(start.x, start.y, far.x, far.y, p1, p2) {
            if t > 0.0 && t < best_t {
                best_t = t;
                best_point = pt;
            }
        }
    }
    
    best_point
}

/// Ray-segment intersection. Ray from (ox,oy) toward (fx,fy), segment p1-p2.
/// Returns (t, intersection_point) where t is the parametric position along the ray.
fn ray_segment_intersection(ox: f64, oy: f64, fx: f64, fy: f64, p1: Coord<f64>, p2: Coord<f64>) -> Option<(f64, Coord<f64>)> {
    let dx = fx - ox;
    let dy = fy - oy;
    let sx = p2.x - p1.x;
    let sy = p2.y - p1.y;
    
    let denom = dx * sy - dy * sx;
    if denom.abs() < 1e-12 { return None; }
    
    let t = ((p1.x - ox) * sy - (p1.y - oy) * sx) / denom;
    let u = ((p1.x - ox) * dy - (p1.y - oy) * dx) / denom;
    
    if t > 1e-9 && u >= 0.0 && u <= 1.0 {
        let pt = Coord { x: ox + t * dx, y: oy + t * dy };
        Some((t, pt))
    } else {
        None
    }
}

/// Check if two subfields share a boundary by looking for nearby vertices.
fn subfields_share_boundary(a: &Polygon<f64>, b: &Polygon<f64>, tol: f64) -> bool {
    let tol_sq = tol * tol;
    let a_coords = &a.exterior().0;
    let b_coords = &b.exterior().0;
    let mut shared_count = 0;
    
    for ac in a_coords {
        for bc in b_coords {
            let dx = ac.x - bc.x;
            let dy = ac.y - bc.y;
            if dx*dx + dy*dy < tol_sq {
                shared_count += 1;
                if shared_count >= 2 { return true; }
            }
        }
    }
    false
}

/// Create a wedge with optional snapped endpoints for the first and last ray.
fn create_wedge_with_endpoints(
    center: Point<f64>, radius: f64,
    theta1: f64, theta2: f64,
    start_pt: Coord<f64>, end_pt: Coord<f64>,
) -> Polygon<f64> {
    let mut coords = vec![Coord { x: center.x(), y: center.y() }];
    // Start with snapped endpoint
    coords.push(start_pt);
    // Arc points in between
    let steps = 30;
    for i in 1..steps {
        let t = theta1 + (theta2 - theta1) * (i as f64 / steps as f64);
        coords.push(Coord {
            x: center.x() + radius * t.cos(),
            y: center.y() + radius * t.sin(),
        });
    }
    // End with snapped endpoint
    coords.push(end_pt);
    coords.push(Coord { x: center.x(), y: center.y() });
    Polygon::new(LineString::from(coords), vec![])
}

fn create_search_wedge(
    centroid: Point<f64>, r: f64,
    theta_start: f64, theta_end: f64,
    v_start: Coord<f64>, v_end: Coord<f64>,
) -> Polygon<f64> {
    let mut coords = vec![v_start];
    coords.push(v_end);
    
    let far_end = Coord {
        x: v_end.x + r * theta_end.cos(),
        y: v_end.y + r * theta_end.sin(),
    };
    coords.push(far_end);
    
    let steps = 30;
    for i in 1..steps {
        let t = theta_end - (theta_end - theta_start) * (i as f64 / steps as f64);
        coords.push(Coord {
            x: centroid.x() + r * t.cos(),
            y: centroid.y() + r * t.sin(),
        });
    }
    
    let far_start = Coord {
        x: v_start.x + r * theta_start.cos(),
        y: v_start.y + r * theta_start.sin(),
    };
    coords.push(far_start);
    coords.push(v_start);
    
    Polygon::new(LineString::from(coords), vec![])
}

/// Create a wedge where the tip is replaced by a segment from the central void.
fn create_wedge_with_void(
    center: Point<f64>, radius: f64, _void_radius: f64,
    theta1: f64, theta2: f64,
    start_pt: Coord<f64>, end_pt: Coord<f64>,
    v_start: Coord<f64>, v_end: Coord<f64>,
) -> Polygon<f64> {
    let mut coords = vec![v_start];
    coords.push(start_pt);
    
    let steps = 30;
    for i in 1..steps {
        let t = theta1 + (theta2 - theta1) * (i as f64 / steps as f64);
        coords.push(Coord {
            x: center.x() + radius * t.cos(),
            y: center.y() + radius * t.sin(),
        });
    }
    
    coords.push(end_pt);
    coords.push(v_end);
    coords.push(v_start);
    
    Polygon::new(LineString::from(coords), vec![])
}

/// Create a regular polygon (K-gon) centered at `center` with circumradius `radius`.
/// Vertices are placed at the angles defined by `ray_angles`.
fn create_regular_polygon(center: Point<f64>, radius: f64, k: usize, ray_angles: &[f64]) -> Polygon<f64> {
    let mut coords: Vec<Coord<f64>> = Vec::with_capacity(k + 1);
    for i in 0..k {
        let angle = ray_angles[i];
        coords.push(Coord {
            x: center.x() + radius * angle.cos(),
            y: center.y() + radius * angle.sin(),
        });
    }
    // Close the polygon
    if let Some(first) = coords.first().cloned() {
        coords.push(first);
    }
    Polygon::new(LineString::from(coords), vec![])
}

// ─── Utility Functions ─────────────────────────────────────────────────

fn rotate_polygon(poly: &Polygon<f64>, theta: f64) -> Polygon<f64> {
    let cos_t = theta.cos();
    let sin_t = theta.sin();
    let ext: Vec<Coord<f64>> = poly.exterior().0.iter().map(|c| {
        Coord {
            x: c.x * cos_t - c.y * sin_t,
            y: c.x * sin_t + c.y * cos_t,
        }
    }).collect();
    Polygon::new(LineString::from(ext), vec![])
}

fn make_rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Polygon<f64> {
    Polygon::new(LineString::from(vec![
        (x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)
    ]), vec![])
}

fn make_half_plane_below(m: f64, k: f64, xc: f64, min_x: f64, max_x: f64, min_y: f64) -> Polygon<f64> {
    let y_left = m * (min_x - xc) + k;
    let y_right = m * (max_x - xc) + k;
    Polygon::new(LineString::from(vec![
        (min_x, min_y),
        (max_x, min_y),
        (max_x, y_right),
        (min_x, y_left),
        (min_x, min_y),
    ]), vec![])
}

fn get_largest_polygon(mp: &MultiPolygon<f64>) -> Option<Polygon<f64>> {
    mp.0.iter().max_by(|a, b| a.unsigned_area().partial_cmp(&b.unsigned_area()).unwrap()).cloned()
}

fn create_wedge(center: Point<f64>, radius: f64, theta1: f64, theta2: f64) -> Polygon<f64> {
    let mut coords = vec![Coord { x: center.x(), y: center.y() }];
    let steps = 30;
    for i in 0..=steps {
        let t = theta1 + (theta2 - theta1) * (i as f64 / steps as f64);
        coords.push(Coord {
            x: center.x() + radius * t.cos(),
            y: center.y() + radius * t.sin(),
        });
    }
    coords.push(Coord { x: center.x(), y: center.y() });
    Polygon::new(LineString::from(coords), vec![])
}

fn geo_to_wasm(p: Polygon<f64>) -> WasmPolygon {
    WasmPolygon {
        exterior: p.exterior().0.iter().map(|c| WasmPoint { x: c.x, y: c.y }).collect()
    }
}
