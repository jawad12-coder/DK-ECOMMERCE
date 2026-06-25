import { formatMoney, loadStoreSettings } from "./store-utils.js"

let cart = localStorage.getItem("cart")
    ? JSON.parse(localStorage.getItem("cart")) : []
let storeSettings = await loadStoreSettings()


function displayCartProduct() {
    let results = ""
    const cartProduct = document.getElementById("cart-product")
    cart.forEach((item) => {
        results += `
        <tr class="cart-item">
            <td></td>
            <td class="cart-image">
                <img src="${item.img.singleImage}" alt="" data-id=${item.id} class="cart-product-image">
                <i class="bi bi-x delete-cart" data-id=${item.id}></i>
            </td>
            <td>${item.name}</td>
            <td>${formatMoney(item.price.newPrice)}</td>
            <td>${item.quantity}</td>
            <td>${formatMoney(item.price.newPrice * item.quantity)}</td>
        </tr>
        `
    })
    cartProduct.innerHTML = results
    removeCartItem()
}

displayCartProduct()

function cartProductRoute() {
    const images = document.querySelectorAll(".cart-product-image")
    images.forEach((image) => {
        image.addEventListener("click", (e) => {
            const imageId = e.target.dataset.id
            localStorage.setItem("productId", JSON.stringify(Number(imageId)))
            window.location.href = `single-product.html?id=${imageId}`
        })
    })
}

cartProductRoute()


function removeCartItem() {

    const btnDeleteCart = document.querySelectorAll(".delete-cart");
    let cartItem = document.querySelector(".header-cart-count")

    btnDeleteCart.forEach((button) => {
        button.addEventListener("click", (e) => {
            const id = e.target.dataset.id;
            cart = cart.filter((item) => item.id !== Number(id));
            displayCartProduct()
            localStorage.setItem("cart", JSON.stringify(cart))
            cartItem.innerHTML = cart.length
            saveCardValues()
        });
    });
}


function saveCardValues() {
    const cartTotal = document.getElementById("cart-total")
    const subTotal = document.getElementById("subtotal")
    const fastCargo = document.getElementById("fast-cargo")
    const fastCargoPrice = Number(storeSettings.localShippingFee || 0)
    let itemsTotal = 0
    let tax = 0

    cart.length > 0 && cart.map((item) => itemsTotal += item.price.newPrice * item.quantity)
    tax = Math.round(itemsTotal * Number(storeSettings.taxRate || 0))
    subTotal.innerHTML = formatMoney(itemsTotal)
    cartTotal.innerHTML = formatMoney(itemsTotal + tax)
    fastCargo.addEventListener("change", (e) => {
        if (e.target.checked) {
            cartTotal.innerHTML = formatMoney(itemsTotal + tax + fastCargoPrice)
        } else {
            cartTotal.innerHTML = formatMoney(itemsTotal + tax)
        }
    })
}


saveCardValues()

const checkoutOrder = document.getElementById("checkout-order")
if (checkoutOrder) {
    checkoutOrder.addEventListener("click", async () => {
        if (!cart.length) {
            alert("Your cart is empty")
            return
        }

        const name = prompt("Customer name")
        const phone = prompt("Phone / WhatsApp number")
        const address = prompt("Delivery address or Google Maps plus code")
        const paymentMethod = prompt("Payment method: cod, easypaisa, jazzcash, bankTransfer", "cod")

        if (!name || !phone || !address) {
            alert("Name, phone and address are required")
            return
        }

        try {
            const response = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer: { name, phone, address },
                    paymentMethod,
                    items: cart
                })
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.message || "Order failed")
            localStorage.removeItem("cart")
            alert(`Order placed: ${data.order.orderNumber}. DK will confirm payment and delivery.`)
            window.location.href = "shop.html"
        } catch (error) {
            alert("Backend order system is not running. On static hosting, send the order by WhatsApp.")
        }
    })
}
