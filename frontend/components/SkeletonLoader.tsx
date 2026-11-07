"use client";

interface SkeletonLoaderProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  radius?: string;
}

/**
 * Reusable animated skeleton placeholder.
 * Renders a pulsing gray block that mimics the shape of real content.
 * Use `width`/`height`/`radius` to approximate the element being replaced.
 */
export function SkeletonLoader({
  className,
  width = "100%",
  height = "1em",
  radius = "md",
  ...rest
}: SkeletonLoaderProps) {
  return (
    <div
      className={`animate-pulse rounded-${radius} bg-gray-200 ${className ?? ""}`}
      style={{ width, height }}
      {...rest}
    />
  );
}
