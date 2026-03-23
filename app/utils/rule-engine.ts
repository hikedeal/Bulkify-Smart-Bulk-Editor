
export interface TaskConfiguration {
    fieldToEdit: string;
    editMethod: string;
    editValue: string;
    rounding?: string;
    roundingValue?: string;
    compareAtPriceOption?: string;
    compareAtEditMethod?: string;
    compareAtEditValue?: string;
    priceOption?: string;
    priceEditMethod?: string;
    priceEditValue?: string;
    weightUnit?: string;
    findText?: string;
    replaceText?: string;
    // Add other config fields if needed
    [key: string]: any;
}

export interface VariantData {
    price: string | number;
    compareAtPrice: string | number | null;
    cost?: string | number;
    inventoryQuantity?: number;
    weight?: number;
    weightUnit?: string;
    requiresShipping?: boolean;
    taxable?: boolean;
    sku?: string;
    barcode?: string;
    inventoryPolicy?: string;
    title?: string;
    hsCode?: string;
    countryCodeOfOrigin?: string;
    [key: string]: any;
}

export function applyTextEdit(originalText: string, method: string, inputs: { value?: string, findText?: string, replaceText?: string, prefixValue?: string, suffixValue?: string }) {
    const original = originalText || "";
    switch (method) {
        case 'fixed':
        case 'set_value':
        case 'set_vendor':
        case 'set_type':
            return inputs.value || "";
        case 'clear_value':
        case 'clear_vendor':
        case 'clear_type':
            return "";
        case 'add_prefix':
            return (inputs.prefixValue || "") + original;
        case 'add_suffix':
            return original + (inputs.suffixValue || "");
        case 'find_replace':
        case 'replace_text':
            if (!inputs.findText) return original;
            return original.split(inputs.findText).join(inputs.replaceText || "");
        default:
            return original;
    }
}

export function applyRounding(value: number, method: string, roundingValue?: string): string {
    if (method === 'none') return value.toFixed(2);
    if (method === 'nearest_01') return (Math.round(value * 100) / 100).toFixed(2);
    if (method === 'nearest_whole') return Math.round(value).toFixed(2);
    if (method === 'nearest_99') return (Math.floor(value) + 0.99).toFixed(2);
    if (method === 'custom_ending') {
        let decimalPart = 0.99;
        if (roundingValue) {
            const parsed = parseFloat(roundingValue);
            if (!isNaN(parsed)) {
                decimalPart = parsed > 1 ? parsed / 100 : parsed;
            }
        }
        return (Math.floor(value) + decimalPart).toFixed(2);
    }
    return value.toFixed(2);
}

export function applyRulesToVariant(variant: VariantData, config: TaskConfiguration) {
    const {
        fieldToEdit,
        editMethod,
        editValue,
        rounding = 'none',
        roundingValue,
        compareAtPriceOption = 'none',
        compareAtEditMethod,
        compareAtEditValue,
        priceOption = 'none',
        priceEditMethod,
        priceEditValue
    } = config;

    const originalPrice = parseFloat(variant.price?.toString() || "0");
    const originalCompareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice?.toString()) : 0;
    const originalCost = parseFloat(variant.cost?.toString() || "0");
    const originalInventory = variant.inventoryQuantity || 0;
    const originalWeight = parseFloat(variant.weight?.toString() || "0");

    let updatedPrice = originalPrice;
    let updatedCompareAt: number | null = originalCompareAt;
    let updatedInventory = originalInventory;
    let updatedWeight = originalWeight;

    const numEditValue = parseFloat(editValue) || 0;

    // 1. Calculate main field
    if (fieldToEdit === 'price' || fieldToEdit === 'compare_price' || fieldToEdit === 'cost') {
        let baseVal = originalPrice;
        if (fieldToEdit === 'compare_price') baseVal = originalCompareAt;
        if (fieldToEdit === 'cost') baseVal = originalCost;

        let newVal = baseVal;
        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'amount_inc') newVal = baseVal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = baseVal - numEditValue;
        else if (editMethod === 'percentage_inc') newVal = baseVal * (1 + numEditValue / 100);
        else if (editMethod === 'percentage_dec') newVal = baseVal * (1 - numEditValue / 100);
        else if (editMethod === 'percentage_of_price') newVal = originalPrice * (numEditValue / 100);
        else if (editMethod === 'set_to_compare_at') newVal = originalCompareAt;
        else if (editMethod === 'percentage_of_compare_at') newVal = originalCompareAt * (numEditValue / 100);
        else if (editMethod === 'set_to_cost') newVal = originalCost;
        else if (editMethod === 'percentage_of_cost') newVal = originalCost * (numEditValue / 100);
        else if (editMethod === 'set_to_price') newVal = originalPrice;

        if (newVal < 0) newVal = 0;
        const roundedVal = applyRounding(newVal, rounding, roundingValue);

        if (fieldToEdit === 'price') updatedPrice = parseFloat(roundedVal);
        else if (fieldToEdit === 'compare_price') updatedCompareAt = parseFloat(roundedVal);
        // Cost is handled differently in updates (inventoryItemId needed), but for calculation logic we include it
    }

    // 2. Handle Compare At Price when editing Price
    if (fieldToEdit === 'price') {
        if (compareAtPriceOption === 'set') {
            let newCompareAt = originalCompareAt;
            const numCompareEditValue = parseFloat(compareAtEditValue || "0");

            if (compareAtEditMethod === 'fixed') newCompareAt = numCompareEditValue;
            else if (compareAtEditMethod === 'amount_inc') newCompareAt = originalCompareAt + numCompareEditValue;
            else if (compareAtEditMethod === 'amount_dec') newCompareAt = originalCompareAt - numCompareEditValue;
            else if (compareAtEditMethod === 'percentage_inc') newCompareAt = originalCompareAt * (1 + numCompareEditValue / 100);
            else if (compareAtEditMethod === 'percentage_dec') newCompareAt = originalCompareAt * (1 - numCompareEditValue / 100);
            else if (compareAtEditMethod === 'set_to_price') newCompareAt = originalPrice;
            else if (compareAtEditMethod === 'percentage_of_price') newCompareAt = originalPrice * (numCompareEditValue / 100);
            else if (compareAtEditMethod === 'percentage_of_compare_at') newCompareAt = originalCompareAt * (numCompareEditValue / 100);
            else if (compareAtEditMethod === 'set_to_cost') newCompareAt = originalCost;
            else if (compareAtEditMethod === 'percentage_of_cost') newCompareAt = originalCost * (numCompareEditValue / 100);
            else if (compareAtEditMethod === 'set_to_null') newCompareAt = -1; // Marker for null

            if (newCompareAt === -1) {
                updatedCompareAt = null;
            } else {
                if (newCompareAt < 0) newCompareAt = 0;
                updatedCompareAt = parseFloat(applyRounding(newCompareAt, rounding, roundingValue));
            }
        } else if (compareAtPriceOption === 'null') {
            updatedCompareAt = null;
        }
    }

    // 3. Handle Price when editing Compare Price
    if (fieldToEdit === 'compare_price') {
        if (priceOption === 'set') {
            let newPrice = originalPrice;
            const numPriceEditValue = parseFloat(priceEditValue || "0");

            if (priceEditMethod === 'fixed') newPrice = numPriceEditValue;
            else if (priceEditMethod === 'amount_inc') newPrice = originalPrice + numPriceEditValue;
            else if (priceEditMethod === 'amount_dec') newPrice = originalPrice - numPriceEditValue;
            else if (priceEditMethod === 'percentage_inc') newPrice = originalPrice * (1 + numPriceEditValue / 100);
            else if (priceEditMethod === 'percentage_dec') newPrice = originalPrice * (1 - numPriceEditValue / 100);
            else if (priceEditMethod === 'set_to_compare_at') newPrice = originalCompareAt;
            else if (priceEditMethod === 'percentage_of_compare_at') newPrice = originalCompareAt * (numPriceEditValue / 100);
            else if (priceEditMethod === 'set_to_cost') newPrice = originalCost;
            else if (priceEditMethod === 'percentage_of_cost') newPrice = originalCost * (numPriceEditValue / 100);

            if (newPrice < 0) newPrice = 0;
            updatedPrice = parseFloat(applyRounding(newPrice, rounding, roundingValue));
        }
    }

    let primaryOriginal: number | boolean | string = originalPrice;
    let primaryUpdated: number | boolean | string = updatedPrice;

    if (fieldToEdit === 'compare_price') {
        primaryOriginal = originalCompareAt;
        primaryUpdated = updatedCompareAt || 0;
    } else if (fieldToEdit === 'cost') {
        primaryOriginal = originalCost;
        // Step 1 calculated roundedVal for newVal when fieldToEdit === 'cost'
        // Let's re-calculate it here precisely for primaryUpdated
        let baseVal = originalCost;
        let newVal = baseVal;
        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'amount_inc') newVal = baseVal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = baseVal - numEditValue;
        else if (editMethod === 'percentage_inc') newVal = baseVal * (1 + numEditValue / 100);
        else if (editMethod === 'percentage_dec') newVal = baseVal * (1 - numEditValue / 100);
        else if (editMethod === 'percentage_of_price') newVal = originalPrice * (numEditValue / 100);
        else if (editMethod === 'set_to_compare_at') newVal = originalCompareAt;
        else if (editMethod === 'percentage_of_compare_at') newVal = originalCompareAt * (numEditValue / 100);
        else if (editMethod === 'set_to_cost') newVal = originalCost;
        else if (editMethod === 'percentage_of_cost') newVal = originalCost * (numEditValue / 100);
        else if (editMethod === 'set_to_price') newVal = originalPrice;

        if (newVal < 0) newVal = 0;
        primaryUpdated = parseFloat(applyRounding(newVal, rounding, roundingValue));
    } else if (fieldToEdit === 'inventory') {
        let baseVal = originalInventory;
        let newVal = baseVal;
        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'amount_inc') newVal = baseVal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = baseVal - numEditValue;

        if (newVal < 0) newVal = 0;
        updatedInventory = Math.round(newVal); // Inventory is always integer
        primaryUpdated = updatedInventory;
    } else if (fieldToEdit === 'weight') {
        let baseVal = originalWeight;
        let newVal = baseVal;
        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'amount_inc') newVal = baseVal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = baseVal - numEditValue;

        if (newVal < 0) newVal = 0;
        updatedWeight = parseFloat(newVal.toFixed(3)); // Weight typically 3 decimals
        primaryUpdated = updatedWeight;
    } else if (fieldToEdit === 'requires_shipping') {
        primaryOriginal = variant.requiresShipping ? 1 : 0; // Use camelCase property
        primaryUpdated = String(config.editValue).toLowerCase() === 'true';
    } else if (fieldToEdit === 'taxable') {
        primaryOriginal = variant.taxable ? 1 : 0;
        primaryUpdated = String(config.editValue).toLowerCase() === 'true';
    } else if (['sku', 'barcode', 'inventory_policy', 'hs_code', 'country_of_origin', 'weight_unit'].includes(fieldToEdit)) {
        let originalText = "";
        if (fieldToEdit === 'sku') originalText = variant.sku || "";
        else if (fieldToEdit === 'barcode') originalText = variant.barcode || "";
        else if (fieldToEdit === 'inventory_policy') originalText = variant.inventoryPolicy || "";
        else if (fieldToEdit === 'hs_code') originalText = variant.hsCode || "";
        else if (fieldToEdit === 'country_of_origin') originalText = variant.countryCodeOfOrigin || "";
        else if (fieldToEdit === 'weight_unit') originalText = variant.weightUnit || "";

        const newVal = applyTextEdit(originalText, editMethod, {
            value: editValue,
            findText: config.findText,
            replaceText: config.replaceText,
            prefixValue: editValue,
            suffixValue: editValue
        });
        primaryOriginal = originalText;
        primaryUpdated = newVal;
    } else if (fieldToEdit === 'inventory_quantity') {
        const baseVal = originalInventory;
        let newVal = baseVal;
        if (editMethod === 'fixed') newVal = numEditValue;
        else if (editMethod === 'amount_inc') newVal = baseVal + numEditValue;
        else if (editMethod === 'amount_dec') newVal = baseVal - numEditValue;

        if (newVal < 0) newVal = 0;
        updatedInventory = Math.round(newVal);
        primaryOriginal = baseVal;
        primaryUpdated = updatedInventory;
    }

    let originalValFormatted: any = variant[fieldToEdit];
    if (fieldToEdit === 'inventory') {
        if (variant.inventoryItem?.tracked === false) {
            originalValFormatted = "Not tracked";
        } else {
            originalValFormatted = originalInventory.toString();
        }
    }
    let updatedValFormatted: any = primaryUpdated;

    if (['price', 'compare_price', 'cost'].includes(fieldToEdit)) {
        originalValFormatted = (primaryOriginal as number).toFixed(2);
        updatedValFormatted = (primaryUpdated as number).toFixed(2);
    } else if (fieldToEdit === 'weight') {
        originalValFormatted = `${originalWeight.toFixed(3)} ${variant.weightUnit || ""}`;
        updatedValFormatted = `${(primaryUpdated as number).toFixed(3)} ${config.weightUnit || variant.weightUnit || ""}`;
    } else if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable') {
        // Format boolean fields as Yes/No for display
        const originalBool = fieldToEdit === 'requires_shipping' ? variant.requiresShipping : variant.taxable;
        originalValFormatted = originalBool ? 'Yes' : 'No';
        updatedValFormatted = primaryUpdated ? 'Yes' : 'No';
    } else if (['sku', 'barcode', 'inventory_policy', 'hs_code', 'country_of_origin', 'weight_unit'].includes(fieldToEdit)) {
        originalValFormatted = primaryOriginal || "(empty)";
        updatedValFormatted = primaryUpdated || "(empty)";
    } else if (fieldToEdit === 'inventory_quantity') {
        originalValFormatted = originalInventory.toString();
        updatedValFormatted = (primaryUpdated as number).toString();
    }

    // If original was "Not tracked", make updated also "Not tracked" to signal no change
    if (originalValFormatted === "Not tracked") {
        updatedValFormatted = "Not tracked";
    }

    return {
        updatedPrice: updatedPrice.toFixed(2),
        updatedCompareAt: updatedCompareAt !== null ? updatedCompareAt.toFixed(2) : null,
        originalPrice: originalPrice.toFixed(2),
        originalCompareAt: variant.compareAtPrice !== null ? originalCompareAt.toFixed(2) : null,
        // Also provide snake_case versions for direct assignment in backend previews
        original_price: originalPrice.toFixed(2),
        updated_price: updatedPrice.toFixed(2),
        original_compare: variant.compareAtPrice !== null ? originalCompareAt.toFixed(2) : null,
        updated_compare: updatedCompareAt !== null ? updatedCompareAt.toFixed(2) : null,
        originalValue: originalValFormatted,
        updatedValue: updatedValFormatted,
        updatedInventory: updatedInventory,
        updatedWeight: updatedWeight
    };
}
