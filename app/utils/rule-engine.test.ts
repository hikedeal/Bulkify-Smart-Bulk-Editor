
import { describe, it, expect } from "vitest";
import { applyRulesToVariant, TaskConfiguration, VariantData } from "./rule-engine";

describe("applyRulesToVariant", () => {
    const mockVariant: VariantData = {
        price: "10.00",
        compareAtPrice: "12.00",
        cost: "5.00",
        inventoryQuantity: 100,
        weight: 1.5,
        weightUnit: "kg",
        requiresShipping: true,
        taxable: true,
        sku: "TEST-SKU",
        title: "Test Product"
    };

    describe("Cost Logic", () => {
        it("should set cost to fixed value", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "fixed",
                editValue: "8.00"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("8.00");
        });

        it("should increase cost by amount", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "amount_inc",
                editValue: "2.00"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("7.00");
        });

        it("should decrease cost by amount", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "amount_dec",
                editValue: "1.00"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("4.00");
        });

        it("should increase cost by percentage", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "percentage_inc",
                editValue: "10"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("5.50");
        });

        it("should set cost to percentage of price", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "percentage_of_price",
                editValue: "50"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("5.00"); // 50% of 10.00 is 5.00
        });

        it("should set cost to percentage of cost", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "percentage_of_cost",
                editValue: "110"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("5.50"); // 110% of 5.00
        });

        it("should set cost equal to cost (no change)", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "set_to_cost",
                editValue: "0"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("5.00");
        });

        it("should set cost to current product price", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "cost",
                editMethod: "set_to_price",
                editValue: "0"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedValue).toBe("10.00");
        });
    });

    describe("Inventory Logic", () => {
        it("should set inventory to fixed value", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "inventory",
                editMethod: "fixed",
                editValue: "50"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedInventory).toBe(50);
        });

        it("should increase inventory by amount", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "inventory",
                editMethod: "amount_inc",
                editValue: "10"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedInventory).toBe(110);
        });
    });

    describe("Weight Logic", () => {
        it("should set weight to fixed value", () => {
            const config: TaskConfiguration = {
                fieldToEdit: "weight",
                editMethod: "fixed",
                editValue: "2.5"
            };
            const result = applyRulesToVariant(mockVariant, config);
            expect(result.updatedWeight).toBe(2.5);
        });
    });
});
