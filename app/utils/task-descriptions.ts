
export const FIELD_LABELS: Record<string, string> = {
    price: "Price",
    compare_price: "Compare at price",
    cost: "Cost",
    inventory: "Inventory",
    tags: "Tags",
    status: "Status",
    metafield: "Metafield",
    weight: "Weight",
    vendor: "Vendor",
    product_type: "Product type",
    requires_shipping: "Requires shipping",
    taxable: "Taxable",
    title: "Title",
    body_html: "Description (HTML)",
    handle: "URL Handle",
    template_suffix: "Template Suffix",
    published: "Published Status",
    seo_title: "SEO Title",
    seo_description: "SEO Description",
    sku: "SKU",
    barcode: "Barcode",
    inventory_policy: "Inventory Policy",
    google_product_category: "Google Product Category",
    google_age_group: "Google Age Group",
    google_gender: "Google Gender",
    google_color: "Google Color",
    google_size: "Google Size",
    google_material: "Google Material",
    google_pattern: "Google Pattern",
    google_condition: "Google Condition",
    google_mpn: "Google MPN",
    google_brand: "Google Brand",
    google_custom_label_0: "Google Custom Label 0",
    google_custom_label_1: "Google Custom Label 1",
    google_custom_label_2: "Google Custom Label 2",
    google_custom_label_3: "Google Custom Label 3",
    google_custom_label_4: "Google Custom Label 4",
    weight_unit: "Weight Unit",
    hs_code: "HS Code",
    country_of_origin: "Country of Origin",
    inventory_quantity: "Inventory Quantity",
    images: "Images/Media",
    manual_collection: "Manual Collection",
    option1_name: "Option 1 Name",
    option2_name: "Option 2 Name",
    option3_name: "Option 3 Name",
    sales_channels: "Sales Channels",
    market_publishing: "Market Publishing",
    add_variants: "Add Variants",
    add_options: "Add Options",
    delete_variants: "Delete Variants",
    delete_products: "Delete Products",
    sort_variants: "Sort Variants",
    reorder_options: "Reorder Options",
    connect_locations: "Connect Locations"
};

export function getTaskDescriptionList(config: any, shopCurrency: string = "$"): string[] {
    const fieldToEdit = config.fieldToEdit || 'price';
    const editMethod = config.editMethod || 'fixed';
    const editValue = config.editValue || '';
    const rounding = config.rounding || 'none';
    const roundingValue = config.roundingValue || '';
    const compareAtPriceOption = config.compareAtPriceOption || 'none';
    const compareAtEditMethod = config.compareAtEditMethod || 'fixed';
    const compareAtEditValue = config.compareAtEditValue || '';
    const priceOption = config.priceOption || 'none';
    const priceEditMethod = config.priceEditMethod || 'fixed';
    const priceEditValue = config.priceEditValue || '';

    const descriptions: string[] = [];
    
    let fieldLabel = FIELD_LABELS[fieldToEdit] || fieldToEdit;

    // Handle Market Price context
    if (fieldToEdit === 'price' && config.applyToMarkets === true && config.applyToBasePrice === false) {
        fieldLabel = "Market Price";
    }

    if (fieldToEdit === 'status') {
        DescriptionsSetStatus(descriptions, editValue);
    } else if (fieldToEdit === 'requires_shipping' || fieldToEdit === 'taxable') {
        const val = editValue === 'true' ? 'True' : 'False';
        descriptions.push(`Set ${fieldLabel} to "${val}"`);
    } else if (fieldToEdit === 'weight') {
        const unit = config.weightUnit || 'kg';
        const method = editMethod === 'fixed' ? 'fixed value' : (editMethod.includes('inc') ? 'increase' : 'decrease');
        descriptions.push(`${fieldLabel} (${method}): ${editValue}${unit}`);
    } else if (fieldToEdit === 'tags') {
        const method = editMethod === 'add_tags' ? 'Add tags' : (editMethod === 'remove_tags' ? 'Remove tags' : 'Replace tags');
        const tags = editValue;
        descriptions.push(`${fieldLabel} (${method}): "${Array.isArray(tags) ? tags.join("\", \"") : tags}"`);
    } else if (fieldToEdit === 'metafield') {
        const mLabel = `Metafield "${config.metafieldName || (config.metafieldNamespace ? `${config.metafieldNamespace}.${config.metafieldKey}` : 'unknown')}"`;
        const methodLabels: any = {
            clear_value: "clear value",
            fixed: "fixed value",
            append_text: "append text",
            replace_text: "replace text",
            increase_number: "increase number",
            decrease_number: "decrease number",
            toggle_boolean: "toggle boolean",
            increase_percent: "increase by percent",
            decrease_percent: "decrease by percent",
            fixed_true: "set to true",
            fixed_false: "set to false",
            add_prefix: "add prefix",
            add_suffix: "add suffix"
        };
        const methodLabel = methodLabels[editMethod] || editMethod;

        if (editMethod === 'clear_value') {
            descriptions.push(`${mLabel} (${methodLabel})`);
        } else if (editMethod === 'toggle_boolean') {
            descriptions.push(`${mLabel} (${methodLabel})`);
        } else if (editMethod === 'fixed' || editMethod === 'fixed_true' || editMethod === 'fixed_false') {
            const val = editMethod === 'fixed_true' ? 'true' : (editMethod === 'fixed_false' ? 'false' : editValue);
            descriptions.push(`${mLabel} (${methodLabel}): "${val}"`);
        } else {
            descriptions.push(`${mLabel} (${methodLabel}): "${editValue}"`);
        }
    } else if (fieldToEdit === 'sales_channels' || fieldToEdit === 'market_publishing') {
        const action = editMethod === 'publish' ? 'Publish to' : 'Unpublish from';
        descriptions.push(`${fieldLabel}: ${action} ${editValue}`);
    } else if (['vendor', 'product_type', 'title', 'body_html', 'handle', 'template_suffix', 'seo_title', 'seo_description', 'sku', 'barcode', 'inventory_policy', 'google_product_category', 'google_age_group', 'google_gender', 'google_color', 'google_size', 'google_material', 'google_pattern', 'google_condition', 'google_mpn', 'google_brand', 'google_custom_label_0', 'google_custom_label_1', 'google_custom_label_2', 'google_custom_label_3', 'google_custom_label_4', 'weight_unit', 'hs_code', 'country_of_origin', 'inventory_quantity', 'images', 'manual_collection', 'option1_name', 'option2_name', 'option3_name', 'add_variants', 'add_options', 'delete_variants', 'delete_products', 'sort_variants', 'reorder_options', 'connect_locations'].includes(fieldToEdit)) {
        const methodLabels: any = {
            fixed: "fixed value",
            add_prefix: "add prefix",
            add_suffix: "add suffix",
            replace_text: "replace text",
            clear_value: "clear value"
        };
        const methodLabel = methodLabels[editMethod] || editMethod;
        if (editMethod === 'clear_value') {
            descriptions.push(`${fieldLabel} (${methodLabel})`);
        } else {
            let val = editValue;
            if (fieldToEdit === 'inventory_policy') {
                val = editValue === 'deny' ? 'Deny' : 'Continue';
            }
            descriptions.push(`${fieldLabel} (${methodLabel}): "${val}"`);
        }
    } else if (fieldToEdit === 'published') {
        const statusLabel = editValue === 'true' ? 'Hidden' : 'Visible';
        descriptions.push(`Set ${fieldLabel} to "${statusLabel}"`);
    } else {
        let mainDescription = "";
        const methodLabels: any = {
            fixed: "fixed value",
            amount_dec: "decrease by amount",
            amount_inc: "increase by amount",
            percentage_dec: "decrease by percentage",
            percentage_inc: "increase by percentage",
            percentage_of_price: "percentage of price",
            set_to_compare_at: "compare-at price",
            percentage_of_compare_at: "percentage of compare-at price",
            set_to_cost: "cost price",
            percentage_of_cost: "percentage of cost price",
            set_to_price: "product price"
        };
        const methodLabel = methodLabels[editMethod] || editMethod;

        const isPriceField = ['price', 'compare_price', 'cost'].includes(fieldToEdit);
        const isPercentage = editMethod.includes("percentage");
        const valueDisplay = isPercentage ? `${editValue}%` : (isPriceField ? `${shopCurrency}${editValue}` : editValue);

        if (editMethod === 'set_to_compare_at' || editMethod === 'set_to_cost' || editMethod === 'set_to_price') {
            mainDescription = `${fieldLabel} (${methodLabel})`;
        } else {
            mainDescription = `${fieldLabel} (${methodLabel}): ${valueDisplay}`;
        }

        if (isPriceField && rounding !== 'none') {
            let roundingDesc = "";
            if (rounding === 'nearest_01') roundingDesc = 'nearest .01';
            else if (rounding === 'nearest_whole') roundingDesc = 'nearest whole number';
            else if (rounding === 'nearest_99') roundingDesc = 'nearest .99';
            else if (rounding === 'custom_ending') roundingDesc = `ending in .${roundingValue || 'xx'}`;
            mainDescription += `. Round to ${roundingDesc}`;
        }
        descriptions.push(mainDescription);

        if (fieldToEdit === 'price' && compareAtPriceOption === 'set') {
            const caIsPercentage = compareAtEditMethod.includes("percentage");
            const caValueDisplay = caIsPercentage ? `${compareAtEditValue}%` : `${shopCurrency}${compareAtEditValue}`;
            const caMethodLabels: any = {
                fixed: "fixed value",
                amount_dec: "decrease by amount",
                amount_inc: "increase by amount",
                percentage_dec: "decrease by percentage",
                percentage_inc: "increase by percentage",
                set_to_price: "price",
                percentage_of_price: "percentage of price",
                percentage_of_compare_at: "percentage of compare-at price",
                set_to_cost: "cost price",
                percentage_of_cost: "percentage of cost price",
                set_to_null: "null (empty)"
            };
            const caMethodLabel = caMethodLabels[compareAtEditMethod] || compareAtEditMethod;

            let caDescription = "";
            if (['set_to_price', 'set_to_cost', 'set_to_null'].includes(compareAtEditMethod)) {
                caDescription = `Compare-at price (${caMethodLabel})`;
            } else {
                caDescription = `Compare-at price (${caMethodLabel}): ${caValueDisplay}`;
            }
            descriptions.push(caDescription);
        } else if (fieldToEdit === 'price' && compareAtPriceOption === 'null') {
            descriptions.push(`Set compare-at price to empty`);
        }

        if (fieldToEdit === 'compare_price' && priceOption === 'set') {
            const pIsPercentage = priceEditMethod.includes("percentage");
            const pValueDisplay = pIsPercentage ? `${priceEditValue}%` : `${shopCurrency}${priceEditValue}`;
            const pMethodLabels: any = {
                fixed: "fixed value",
                amount_dec: "decrease by amount",
                amount_inc: "increase by amount",
                percentage_dec: "decrease by percentage",
                percentage_inc: "increase by percentage",
                set_to_compare_at: "compare-at price",
                percentage_of_compare_at: "percentage of compare-at price",
                set_to_cost: "cost price",
                percentage_of_cost: "percentage of cost price",
                set_to_price: "product price"
            };
            const pMethodLabel = pMethodLabels[priceEditMethod] || priceEditMethod;

            let pDescription = "";
            if (['set_to_compare_at', 'set_to_cost', 'set_to_price'].includes(priceEditMethod)) {
                pDescription = `Set the price (${pMethodLabel})`;
            } else {
                pDescription = `Set the price (${pMethodLabel}): ${pValueDisplay}`;
            }
            descriptions.push(pDescription);
        } else if (fieldToEdit === 'compare_price' && priceOption === 'none') {
            descriptions.push("Don't change price");
        }
    }

    // Add secondary actions (Tags Manager)
    if (config.addTags && config.tagsToAdd) {
        descriptions.push(`Add tags: "${config.tagsToAdd}"`);
    }
    if (config.removeTags && config.tagsToRemove) {
        descriptions.push(`Remove tags: "${config.tagsToRemove}"`);
    }

    if (config.applyToMarkets) {
        if (config.selectedMarkets && config.selectedMarkets.length > 0) {
            descriptions.push(`Apply to markets: ${config.selectedMarkets.join(", ")}`);
        }
        if (config.applyToBasePrice === false) {
            descriptions.push("Base price will NOT be updated");
        } else {
            descriptions.push("Updates applied to Base Price and Markets");
        }
    }

    return descriptions;
}

function DescriptionsSetStatus(descriptions: string[], editValue: string) {
    descriptions.push(`Set status to "${editValue || 'Active'}"`);
}

export function getAppliesToText(config: any): string {
    const productSelection = config.productSelection || 'all';

    if (productSelection === 'specific') {
        const count = config.selectedProducts?.length || 0;
        return `${count} product${count !== 1 ? 's' : ''} selected`;
    } else if (productSelection === 'collections') {
        const count = config.selectedCollections?.length || 0;
        return `${count} collection${count !== 1 ? 's' : ''} selected`;
    } else if (productSelection === 'conditions') {
        return "Custom conditions";
    }
    return "All products";
}
