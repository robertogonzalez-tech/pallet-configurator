#!/usr/bin/env python3
"""Convert STEP files to GLB format for web 3D viewing."""

import os
import sys
import cadquery as cq
import trimesh

def step_to_glb(step_path, glb_path):
    """Convert STEP to GLB using CadQuery and trimesh."""
    print(f"  Loading STEP: {step_path}")
    
    # Load STEP file with CadQuery
    result = cq.importers.importStep(step_path)
    
    # Export to STL (intermediate format)
    stl_path = step_path.replace('.step', '.stl')
    cq.exporters.export(result, stl_path, exportType='STL')
    print(f"  Created STL: {stl_path}")
    
    # Load STL with trimesh and export to GLB
    mesh = trimesh.load(stl_path)
    
    # Center the mesh and scale to reasonable size (mm to inches / 25.4)
    mesh.apply_translation(-mesh.centroid)
    
    # Export as GLB
    mesh.export(glb_path, file_type='glb')
    print(f"  Created GLB: {glb_path}")
    
    # Clean up STL
    # os.remove(stl_path)
    
    return True

def main():
    models_dir = "/Users/brooke/clawd/apps/pallet-configurator/public/models"
    
    step_files = [
        ("dd-slide-assembly.step", "dd-slide-assembly.glb"),
        ("dd-lower-track.step", "dd-lower-track.glb"),
        ("dd-support-leg.step", "dd-support-leg.glb"),
        ("dd-manifold.step", "dd-manifold.glb"),
    ]
    
    for step_name, glb_name in step_files:
        step_path = os.path.join(models_dir, step_name)
        glb_path = os.path.join(models_dir, glb_name)
        
        if not os.path.exists(step_path):
            print(f"SKIP: {step_name} not found")
            continue
            
        print(f"\nConverting: {step_name}")
        
        try:
            step_to_glb(step_path, glb_path)
            print(f"  SUCCESS!")
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()
