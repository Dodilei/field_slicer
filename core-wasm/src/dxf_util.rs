use dxf::Drawing;
use dxf::entities::{Entity, EntityType, LwPolyline, LwPolylineVertex};
use crate::geometry::{WasmPolygon, WasmPoint};
use std::io::Cursor;

pub fn extract_boundary(data: &[u8]) -> Result<WasmPolygon, String> {
    let mut cursor = Cursor::new(data);
    let drawing = Drawing::load(&mut cursor).map_err(|e| format!("Failed to parse DXF: {:?}", e))?;
    
    for entity in &drawing.entities {
        if let EntityType::LwPolyline(poly) = &entity.specific {
            let mut ext = vec![];
            for v in &poly.vertices {
                ext.push(WasmPoint { x: v.x, y: v.y });
            }
            if !ext.is_empty() {
                return Ok(WasmPolygon { exterior: ext });
            }
        }
        
        if let EntityType::Polyline(poly) = &entity.specific {
            let mut ext = vec![];
            for v in &poly.vertices {
                ext.push(WasmPoint { x: v.location.x, y: v.location.y });
            }
            if !ext.is_empty() {
                return Ok(WasmPolygon { exterior: ext });
            }
        }
    }
    Err("No valid bounded polyline found in DXF.".into())
}

pub fn generate_dxf_bytes(polygons: &[WasmPolygon]) -> Result<Vec<u8>, String> {
    let mut drawing = Drawing::default();
    
    for poly in polygons {
        let mut lwpoly = LwPolyline::default();
        lwpoly.is_closed = true;
        for p in &poly.exterior {
            let mut v = LwPolylineVertex::default();
            v.x = p.x;
            v.y = p.y;
            lwpoly.vertices.push(v);
        }
        drawing.entities.push(Entity::new(EntityType::LwPolyline(lwpoly)));
    }
    
    let mut cursor = Cursor::new(Vec::new());
    drawing.save(&mut cursor).map_err(|e| format!("Failed to save DXF: {:?}", e))?;
    Ok(cursor.into_inner())
}

