import React from 'react';
import { cx } from './utils';

export function Skeleton({ className }) {
  return <div className={cx('animate-pulse rounded-md bg-gray-200', className)} />;
}

export function SkeletonText({ lines = 3 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export default Skeleton;
