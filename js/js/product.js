import { product1, product2 } from "./glide.js"
import { formatMoney } from "./store-utils.js"


export let cart = localStorage.getItem("cart")
    ? JSON.parse(localStorage.getItem("cart")) : []


function addToCart(products) {
    const cartItem = document.querySelector(".header-cart-count")
    const buttons = [...document.getElementsByClassName("add-to-cart")]
    buttons.forEach((button) => {
        const inCart = cart.find((item) => item.id === Number(button.dataset.id))
        if (inCart) {
            button.setAttribute("disabled", "disabled")
        } else {
            button.addEventListener("click", function (e) {
                const id = e.target.dataset.id
                const findProduct = products.find((product) => product.id === Number(id))
                cart.push({ ...findProduct, quantity: 1 })
                localStorage.setItem("cart", JSON.stringify(cart))
                button.setAttribute("disabled", "disabled")
                cartItem.innerHTML = cart.length
            })
        }
    })
}

function productRoute() {
    const productLink = document.getElementsByClassName("product-route")
    Array.from(productLink).forEach((button) => {
        button.addEventListener("click", (e) => {
            e.preventDefault()
            const id = e.currentTarget.dataset.id
            localStorage.setItem("productId", JSON.stringify(id))
            window.location.href = "single-product.html"
        })
    })
}


async function productFunc(products) {


    const productsContainer = document.getElementById("product-list")
    const productsContainer2 = document.getElementById("product-list-2")
    let results = ""

    products.forEach((product) => {
        const category = product.category ? `<span class="product-category">${product.category}</span>` : ""
        const productUrl = `single-product.html?id=${product.id}`
        results += `
                <li class="product-item glide__slide">
                    <div class="product-image">
                        <a href="${productUrl}" class="product-route" data-id="${product.id}">
                            <img src="${product.img.singleImage}" alt="" class="img1" />
                            <img src="${product.img.thumbs[1]}" alt="" class="img2" />
                        </a>
                    </div>
                    <div class="product-info">
                    ${category}
                    <a href="${productUrl}" class="product-title product-route" data-id="${product.id}"> ${product.name} </a>
                    <ul class="product-star">
                        <li>
                        <i class="bi bi-star-fill"></i>
                        </li>
                        <li>
                        <i class="bi bi-star-fill"></i>
                        </li>
                        <li>
                        <i class="bi bi-star-fill"></i>
                        </li>
                        <li>
                        <i class="bi bi-star-fill"></i>
                        </li>
                        <li>
                        <i class="bi bi-star-half"></i>
                        </li>
                    </ul>
                    <div class="product-prices">
                        <strong class="new-price">${formatMoney(product.price.newPrice)}</strong>
                        <span class="old-price">${formatMoney(product.price.oldPrice)}</span>
                    </div>
                    <span class="product-discount"> ${product.discount}% </span>
                    <div class="product-links">
                        <button class="add-to-cart" data-id="${product.id}">
                        <i class="bi bi-basket-fill"></i>
                        </button>
                        <button>
                        <i class="bi bi-heart-fill"></i>
                        </button>
                        <a href="${productUrl}" class="product-route" data-id="${product.id}">
                        <i class="bi bi-eye-fill"></i>
                        </a>
                        <a href="#">
                        <i class="bi bi-share-fill"></i>
                        </a>
                    </div>
                    </div>
            </li>
        `

    })

    productsContainer ? productsContainer.innerHTML = results : ""
    productsContainer ? productsContainer2.innerHTML = results : ""

    addToCart(products)

    if (window.location.pathname.includes("shop.html")) {
        document.body.classList.add("shop-products-grid")
    } else {
        product1()
        product2()
    }

    productRoute()
}



export default productFunc
