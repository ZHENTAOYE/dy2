// Historical data used on screen. Sources: manufacturer datasheets / widely cited figures.

/** Transistors per chip. */
export const CHIPS: { year: number; name: string; count: number }[] = [
  { year: 1971, name: "Intel 4004", count: 2_300 },
  { year: 1978, name: "Intel 8086", count: 29_000 },
  { year: 1985, name: "Intel 386", count: 275_000 },
  { year: 1989, name: "Intel 486", count: 1_200_000 },
  { year: 1993, name: "Pentium", count: 3_100_000 },
  { year: 2000, name: "Pentium 4", count: 42_000_000 },
  { year: 2006, name: "Core 2 Duo", count: 291_000_000 },
  { year: 2012, name: "NVIDIA GK110", count: 7_080_000_000 },
  { year: 2017, name: "NVIDIA V100", count: 21_100_000_000 },
  { year: 2020, name: "NVIDIA A100", count: 54_200_000_000 },
  { year: 2022, name: "NVIDIA H100", count: 80_000_000_000 },
  { year: 2024, name: "NVIDIA B200", count: 208_000_000_000 },
];

/** Log-linear interpolation of transistor count at a (fractional) year. */
export const countAt = (year: number) => {
  if (year <= CHIPS[0].year) return CHIPS[0].count;
  for (let i = 1; i < CHIPS.length; i++) {
    const a = CHIPS[i - 1];
    const b = CHIPS[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return Math.exp(Math.log(a.count) + (Math.log(b.count) - Math.log(a.count)) * t);
    }
  }
  return CHIPS[CHIPS.length - 1].count;
};

/** Single-thread CPU clock frequency (Hz), representative desktop parts. */
export const CLOCKS: { year: number; hz: number }[] = [
  { year: 1971, hz: 740e3 },
  { year: 1978, hz: 5e6 },
  { year: 1985, hz: 16e6 },
  { year: 1989, hz: 25e6 },
  { year: 1993, hz: 66e6 },
  { year: 1997, hz: 300e6 },
  { year: 2000, hz: 1.5e9 },
  { year: 2002, hz: 3.06e9 },
  { year: 2004, hz: 3.8e9 },
  { year: 2008, hz: 3.2e9 },
  { year: 2012, hz: 3.5e9 },
  { year: 2016, hz: 4.0e9 },
  { year: 2020, hz: 4.8e9 },
  { year: 2024, hz: 5.0e9 },
];

/** ImageNet (ILSVRC) top-5 error of the winning entry, %. */
export const IMAGENET: { year: number; err: number; label: string }[] = [
  { year: 2010, err: 28.2, label: "传统方法" },
  { year: 2011, err: 25.8, label: "传统方法" },
  { year: 2012, err: 15.3, label: "AlexNet" },
  { year: 2013, err: 11.7, label: "ZFNet" },
  { year: 2014, err: 6.7, label: "GoogLeNet" },
  { year: 2015, err: 3.6, label: "ResNet" },
];
export const HUMAN_ERR = 5.1;

/** Chinese short form for a transistor count. */
export const cnCount = (n: number) => {
  if (n >= 1e8) {
    const v = n / 1e8;
    return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}亿`;
  }
  if (n >= 1e4) {
    const v = n / 1e4;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return Math.round(n).toLocaleString("en-US");
};
