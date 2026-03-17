export interface VariantNode {
    id: string;
    price: string;
    title: string;
}

export interface VariantEdge {
    node: VariantNode;
}

export interface ProductNode {
    id: string;
    title: string;
    variants: {
        edges: VariantEdge[];
    };
}

export interface ProductEdge {
    node: ProductNode;
}

export interface FilterOptions {
    collectionId?: string;
    productType?: string;
    tag?: string;
}

export interface PriceAdjustment {
    type: "fixed" | "percentage";
    value: number;
}

export interface PreviewResult extends ProductNode {
    variants: {
        edges: (VariantEdge & { node: VariantNode & { newPrice: string; originalPrice: string } })[];
    };
}
