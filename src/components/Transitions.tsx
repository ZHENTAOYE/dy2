import React from 'react';
import {useCurrentFrame} from 'remotion';
import {SCENES} from '../timeline';
import {clamp} from '../lib/util';

/**
 * A fast "refresh scan" at every scene cut: a bright scanline sweeps the
 * screen top→bottom while a thin chromatic band trails it. Keeps cuts
 * punchy without adding another full-screen flash.
 */
export const Transitions: React.FC = () => {
	const frame = useCurrentFrame();
	for (const s of SCENES.slice(1)) {
		const d = frame - (s.from - 6);
		if (d < 0 || d > 14) continue;
		const t = d / 14;
		const y = -80 + t * 2080;
		const a = Math.sin(Math.PI * clamp(t)) * 0.9;
		return (
			<div style={{position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen'}}>
				<div
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: y - 260,
						height: 260,
						background: 'linear-gradient(to bottom, transparent, rgba(80,200,255,0.10) 60%, rgba(255,60,200,0.18))',
						opacity: a,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: y - 3,
						height: 6,
						background: '#fff',
						boxShadow: '0 0 30px 12px rgba(160,230,255,0.9)',
						opacity: a,
					}}
				/>
			</div>
		);
	}
	return null;
};
