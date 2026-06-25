export function formatMoney(value) {
    return `PKR ${Number(value || 0).toLocaleString("en-PK", {
        maximumFractionDigits: 0
    })}`
}

export async function loadStoreProducts() {
    try {
        const response = await fetch("/api/products")
        if (!response.ok) throw new Error("API unavailable")
        const data = await response.json()
        return data.products || []
    } catch {
        const response = await fetch("js/data.json")
        return response.json()
    }
}

export async function loadStoreSettings() {
    try {
        const response = await fetch("/api/settings")
        if (!response.ok) throw new Error("API unavailable")
        const data = await response.json()
        return data.settings
    } catch {
        return {
            currency: "PKR",
            taxRate: 0,
            freeShippingMin: 50000,
            localShippingFee: 250,
            paymentMethods: {
                cod: true,
                easypaisa: true,
                jazzcash: true,
                bankTransfer: true
            }
        }
    }
}
