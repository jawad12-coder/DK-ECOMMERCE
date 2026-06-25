import { product3 } from "./glide.js"
import { thumbsActiveFunc } from "./single-product/thumbsActive.js"
import zoomFunc from "./single-product/zoom.js"
import colorsFunc from "./single-product/colors.js"
import valuesFunc from "./single-product/values.js"
import tabsFunc from "./single-product/tabs.js"
import commentsfunc from "./single-product/comments.js"
import { formatMoney, loadStoreProducts } from "./store-utils.js"

const urlProductId = new URLSearchParams(window.location.search).get("id")
const savedProductId = localStorage.getItem("productId")
    ? JSON.parse(localStorage.getItem("productId"))
    : 1
const productId = Number(urlProductId || savedProductId || 1)
localStorage.setItem("productId", JSON.stringify(productId))

let products = localStorage.getItem("products")
    ? JSON.parse(localStorage.getItem("products"))
    : []

if (!products.length) {
    products = await loadStoreProducts()
    localStorage.setItem("products", JSON.stringify(products))
}

const findProduct = products.find((item) => item.id === Number(productId)) || products[0]

/* product title */
const productTitle = document.querySelector(".product-title")
productTitle.innerHTML = findProduct.name

const productDescription = document.querySelector(".product-description")
if (productDescription && findProduct.description) {
    productDescription.innerHTML = findProduct.description
}


/* product price */
const productOldPrice = document.querySelector(".old-price")
productOldPrice.innerHTML = formatMoney(findProduct.price.oldPrice)

const productNewPrice = document.querySelector(".new-price")
productNewPrice.innerHTML = formatMoney(findProduct.price.newPrice)

/* product gallery */
const singleImage = document.getElementById("single-image")
singleImage.src = findProduct.img.singleImage

/* gallery thumbs */

const galleryThumbs = document.querySelector(".gallery-thumbs")
let result = ""

findProduct.img.thumbs.forEach((item) => {
    result += `
        <li class="glide__slide">
            <img src="${item}" class="img-fluid" alt="">
        </li>
    `
})

galleryThumbs.innerHTML = result

const productCategory = document.querySelector(".product-categories a")
if (productCategory && findProduct.category) {
    productCategory.innerHTML = findProduct.category
}

const productTags = document.querySelector(".product-tags a")
if (productTags && findProduct.tags) {
    productTags.innerHTML = findProduct.tags.join(" , ")
}

const valuesList = document.querySelector(".values-list")
if (valuesList && findProduct.specs) {
    valuesList.innerHTML = findProduct.specs.map((item) => `<span>${item}</span>`).join("")
}

thumbsActiveFunc()
product3()

/* thumbs active */
const productThumbs = document.querySelectorAll(".product-thumb .glide__slide img")
productThumbs[0].classList.add("active")




//add to cart
const cart = localStorage.getItem("cart")
    ? JSON.parse(localStorage.getItem("cart")) : []

const btnAddCart = document.getElementById("add-to-cart")
const quantity = document.getElementById("quantity")
const cartItem = document.querySelector(".header-cart-count")

const findCart = cart.find((item) => item.id === findProduct.id)

if (findCart) {
    btnAddCart.setAttribute("disabled", "disabled")
    btnAddCart.style.opacity = 0.4
    btnAddCart.style.cursor = "no-drop"
} else {
    btnAddCart.addEventListener("click", function () {
        cart.push({ ...findProduct, quantity: Number(quantity.value) })
        btnAddCart.setAttribute("disabled", "disabled")
        btnAddCart.style.opacity = 0.4
        btnAddCart.style.cursor = "no-drop"
        localStorage.setItem("cart", JSON.stringify(cart))
        cartItem.innerHTML = cart.length
    })
}
