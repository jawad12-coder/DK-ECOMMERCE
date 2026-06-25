import { formatMoney } from "./store-utils.js"

function searchFunc(data) {
    const searchWrapper = document.querySelector(".search-result .results")
    const searchInput = document.querySelector(".modal-search .search input")

    if (!searchWrapper || !searchInput) return

    function renderResults(items) {
        if (!items.length) {
            searchWrapper.innerHTML = `
                <a href="shop.html" class="result-item" style="justify-content: center">
                    No matching DK product found
                </a>
            `
            return
        }

        searchWrapper.innerHTML = items.map((item) => `
            <a href="single-product.html?id=${item.id}" class="result-item" data-id="${item.id}">
                <img src="${item.img.singleImage}" class="search-thumb" alt="${item.name}">
                <div class="search-info">
                    <h4>${item.name}</h4>
                    <span class="search-sku">${item.category || "DK Gaming Gear"}</span>
                    <span class="search-price">${formatMoney(item.price.newPrice)}</span>
                </div>
            </a>
        `).join("")

        searchRouter()
    }

    renderResults(data)

    searchInput.addEventListener("input", (e) => {
        const value = e.target.value.trim().toLowerCase()
        const filtered = value
            ? data.filter((item) => item.name.trim().toLowerCase().includes(value))
            : data

        renderResults(filtered)
    })
}

function searchRouter() {
    const searchRoute = document.querySelectorAll(".results .result-item")
    searchRoute.forEach((item) => {
        item.addEventListener("click", () => {
            const id = item.dataset.id
            if (id) {
                localStorage.setItem("productId", JSON.stringify(Number(id)))
            }
        })
    })
}

export default searchFunc
