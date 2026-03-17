import { describe, it, expect } from 'vitest';
import { calculatePreview } from './price-calculator';
import type { ProductNode } from '../types';

describe('calculatePreview', () => {
    const mockProducts: ProductNode[] = [
        {
            id: 'gid://shopify/Product/1',
            title: 'Test Product',
            variants: {
                edges: [
                    {
                        node: {
                            id: 'gid://shopify/ProductVariant/1',
                            title: 'Default Title',
                            price: '100.00'
                        }
                    }
                ]
            }
        }
    ];

    it('should calculate percentage increase correctly', () => {
        const result = calculatePreview(mockProducts, { type: 'percentage', value: 10 });
        const newPrice = result[0].variants.edges[0].node.newPrice;
        expect(newPrice).toBe('110.00');
    });

    it('should calculate percentage decrease correctly', () => {
        const result = calculatePreview(mockProducts, { type: 'percentage', value: -20 });
        const newPrice = result[0].variants.edges[0].node.newPrice;
        expect(newPrice).toBe('80.00');
    });

    it('should calculate fixed amount increase correctly', () => {
        const result = calculatePreview(mockProducts, { type: 'fixed', value: 50 });
        const newPrice = result[0].variants.edges[0].node.newPrice;
        expect(newPrice).toBe('150.00');
    });

    it('should calculate fixed amount decrease correctly', () => {
        const result = calculatePreview(mockProducts, { type: 'fixed', value: -10 });
        const newPrice = result[0].variants.edges[0].node.newPrice;
        expect(newPrice).toBe('90.00');
    });

    it('should not allow negative prices', () => {
        const result = calculatePreview(mockProducts, { type: 'fixed', value: -200 });
        const newPrice = result[0].variants.edges[0].node.newPrice;
        expect(newPrice).toBe('0.00');
    });
});
