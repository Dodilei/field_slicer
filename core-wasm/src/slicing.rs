use crate::geometry::{WasmPolygon, WasmPoint};
use geo::{Polygon, MultiPolygon, Rect, Coord, Area, BoundingRect, Point, Centroid, LineString};
use geo_booleanop::boolean::BooleanOp;
use std::f64::consts::PI;

pub fn slice(
    polygon: &WasmPolygon,
    n_subfields: usize,
    k_slices: usize,
    pizza_phase: f64
) -> Result<Vec<WasmPolygon>, String> {
    let ext: Vec<Coord<f64>> = polygon.exterior.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
    // Safety matching exactly what was read in:
    if ext.is_empty() { return Ok(vec![]); }
    let geo_poly = Polygon::new(LineString::new(ext), vec![]);
    
    let subfields = bisect_recursive(&geo_poly, n_subfields, true);
    
    let mut final_polys = Vec::new();
    for sf in subfields {
        let slices = radial_slice(&sf, k_slices, pizza_phase);
        for s in slices {
            final_polys.push(geo_to_wasm(s));
        }
    }
    
    Ok(final_polys)
}

fn bisect_recursive(poly: &Polygon<f64>, n: usize, horizontal: bool) -> Vec<Polygon<f64>> {
    if n <= 1 {
        return vec![poly.clone()];
    }
    let n1 = n / 2;
    let n2 = n - n1;
    let ratio = n1 as f64 / n as f64;
    
    let bbox = poly.bounding_rect().unwrap_or(Rect::new(Coord{x:0.,y:0.}, Coord{x:1.,y:1.}));
    
    let mut min_val = if horizontal { bbox.min().y } else { bbox.min().x };
    let mut max_val = if horizontal { bbox.max().y } else { bbox.max().x };
    
    let target_area = poly.unsigned_area() * ratio;
    
    let mut best_poly1 = MultiPolygon(vec![poly.clone()]);
    let mut best_poly2 = MultiPolygon(vec![]);
    
    for _ in 0..40 {
        let mid = (min_val + max_val) / 2.0;
        
        let clip_rect = if horizontal {
            Rect::new(
                Coord { x: bbox.min().x - 1.0, y: bbox.min().y - 1.0 },
                Coord { x: bbox.max().x + 1.0, y: mid }
            )
        } else {
            Rect::new(
                Coord { x: bbox.min().x - 1.0, y: bbox.min().y - 1.0 },
                Coord { x: mid, y: bbox.max().y + 1.0 }
            )
        };
        
        let clip_poly = Polygon::new(
            LineString::from(vec![
                (clip_rect.min().x, clip_rect.min().y),
                (clip_rect.max().x, clip_rect.min().y),
                (clip_rect.max().x, clip_rect.max().y),
                (clip_rect.min().x, clip_rect.max().y),
                (clip_rect.min().x, clip_rect.min().y),
            ]),
            vec![]
        );
        
        let intersect = poly.intersection(&clip_poly);
        let area = intersect.unsigned_area();
        
        if area < target_area {
            min_val = mid;
        } else {
            max_val = mid;
        }
        best_poly1 = intersect;
        best_poly2 = poly.difference(&clip_poly);
    }
    
    let p1 = get_largest_polygon(&best_poly1).unwrap_or(poly.clone());
    let p2 = get_largest_polygon(&best_poly2).unwrap_or(poly.clone());
    
    let mut res = bisect_recursive(&p1, n1, !horizontal);
    res.extend(bisect_recursive(&p2, n2, !horizontal));
    res
}

fn get_largest_polygon(mp: &MultiPolygon<f64>) -> Option<Polygon<f64>> {
    mp.0.iter().max_by(|a, b| a.unsigned_area().partial_cmp(&b.unsigned_area()).unwrap()).cloned()
}

fn radial_slice(poly: &Polygon<f64>, k: usize, phase: f64) -> Vec<Polygon<f64>> {
    if k <= 1 {
        return vec![poly.clone()];
    }
    let centroid = poly.centroid().unwrap_or(Point::new(0., 0.));
    let bbox = poly.bounding_rect().unwrap_or(Rect::new(Coord{x:0.,y:0.}, Coord{x:1.,y:1.}));
    let r = ((bbox.max().x - bbox.min().x).powi(2) + (bbox.max().y - bbox.min().y).powi(2)).sqrt() * 2.0;
    
    let mut slices = Vec::new();
    let mut current_angle = phase * 2.0 * PI;
    let target_area = poly.unsigned_area() / k as f64;
    
    for _ in 0..(k-1) {
        let mut min_theta = current_angle;
        let mut max_theta = current_angle + 2.0 * PI;
        let mut best_slice = MultiPolygon(vec![poly.clone()]);
        
        for _ in 0..40 {
            let mid_theta = (min_theta + max_theta) / 2.0;
            let wedge = create_wedge(centroid, r, current_angle, mid_theta);
            let intersect = poly.intersection(&wedge);
            let area = intersect.unsigned_area();
            if area < target_area {
                min_theta = mid_theta;
            } else {
                max_theta = mid_theta;
            }
            best_slice = intersect;
        }
        current_angle = (min_theta + max_theta) / 2.0;
        if let Some(p) = get_largest_polygon(&best_slice) {
            slices.push(p);
        }
    }
    
    let last_wedge = create_wedge(centroid, r, current_angle, phase * 2.0 * PI + 2.0 * PI);
    if let Some(p) = get_largest_polygon(&poly.intersection(&last_wedge)) {
         slices.push(p);
    }
    
    slices
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
