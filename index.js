require('dotenv').config();
const express = require("express");
const app = express();
const cors = require("cors");
const SSLCommerzPayment = require("sslcommerz-lts");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri =
process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const store_id =process.env.SSL_STORE_ID;
const store_passwd = process.env.SSL_STORE_PASSWORD;
const is_live = process.env.SSL_IS_LIVE === "true"; //true for live, false for sandbox

async function run() {
  try {
    await client.connect();
    const bookCollections = client.db("BookInventory").collection("Books");
    const ordersCollection = client.db("BookInventory").collection("Orders");

    const cartCollection = client.db("BookInventory").collection("Carts");

    app.post("/upload-book", async (req, res) => {
      const data = req.body;
      const result = await bookCollections.insertOne(data);
      res.send(result);
    });

    app.get("/all-books", async (req, res) => {
      let query = {};
      if (req.query?.category) {
        query = { category: req.query.category };
      }
      const result = await bookCollections.find(query).toArray();
      res.send(result);
    });

    app.patch("/book/:id", async (req, res) => {
      const id = req.params.id;
      const updateBookData = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          ...updateBookData,
        },
      };
      const options = { upsert: true };
      const result = await bookCollections.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.post("/submit-order", async (req, res) => {
      const {
        customerName,
        productCode,
        postCode,
        address,
        phoneNumber,
        price,
        email,
      } = req.body;

      const tran_id = new ObjectId().toString();

      const data = {
        total_amount: price,
        currency: "BDT",
        tran_id: tran_id,
        success_url: `http://localhost:5000/payment/success/${tran_id}`,
        fail_url: "http://localhost:3030/fail",
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: customerName,
        cus_email: email,
        cus_add1: address,
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: phoneNumber,
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: postCode,
        ship_country: "Bangladesh",
      };

      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);

      sslcz.init(data).then(async (apiResponse) => {
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });

        // Save the order data with tran_id before redirecting
        const orderData = {
          tranId: tran_id,
          customerName,
          productCode,
          postCode,
          address,
          phoneNumber,
          price,
          email,
          val_id: "",
        };
        await ordersCollection.insertOne(orderData);
      });

      console.log("Order received:", req.body);
      console.log(data);
    });

    app.post("/payment/success/:tranId", async (req, res) => {
      const tranId = req.params.tranId;
      const { val_id } = req.body;

      // Update the order with the val_id
      const filter = { tranId: tranId };
      const updateDoc = {
        $set: {
          val_id: val_id,
        },
      };
      const result = await ordersCollection.updateOne(filter, updateDoc);

      res.redirect(`http://localhost:5173/payment-success?tranId=${tranId}`);
    });

    app.delete("/book/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await bookCollections.deleteOne(filter);
      res.send(result);
    });

    app.get("/orders/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const orders = await ordersCollection.find(query).toArray();
      res.send(orders);
    });


    // Update this endpoint to fetch all orders
    app.get("/orders", async (req, res) => {
      const orders = await ordersCollection.find({}).toArray();
      res.send(orders);
    });

    app.get("/book/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await bookCollections.findOne(filter);
      res.send(result);
    });



    // Cart API endpoints

    app.post("/cart", async (req, res) => {
      const { userId, bookId } = req.body;
    
      if (!userId || !bookId) {
        return res.status(400).json({ error: "User ID and Book ID are required" });
      }
    
      const cartCollection = client.db("BookInventory").collection("Carts");
      const userCart = await cartCollection.findOne({ userId });
    
      if (userCart) {
        // If the user already has a cart, update it
        const result = await cartCollection.updateOne(
          { userId },
          { $addToSet: { items: bookId } }
        );
        res.send(result);
      } else {
        // If the user doesn't have a cart, create one
        const result = await cartCollection.insertOne({ userId, items: [bookId] });
        res.send(result);
      }
    });



    
    app.get("/cart/:userId", async (req, res) => {
      try {
        const { userId } = req.params;
        const cartCollection = client.db("BookInventory").collection("Carts");
        const bookCollections = client.db("BookInventory").collection("Books");
        const userCart = await cartCollection.findOne({ userId });
    
        if (userCart) {
          const bookDetailsPromises = userCart.items.map(async (bookId) => {
            const book = await bookCollections.findOne({ _id: new ObjectId(bookId) });
            if (book) {
              return {
                _id: book._id,
                title: book.bookTitle,
                author: book.authorName,
                image: book.imageURL,
                price: book.price,
              };
            } else {
              // console.warn(`Book with ID ${bookId} not found`);
              return null;
            }
          });
    
          const bookDetails = (await Promise.all(bookDetailsPromises)).filter(Boolean);
          res.send({ items: bookDetails });
        } else {
          res.status(404).json({ error: "Cart not found" });
        }
      } catch (error) {
        console.error("Error fetching cart:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    
    




    
    app.delete("/cart", async (req, res) => {
      const { userId, bookId } = req.body;
    
      if (!userId || !bookId) {
        return res.status(400).json({ error: "User ID and Book ID are required" });
      }
    
      const cartCollection = client.db("BookInventory").collection("Carts");
      const result = await cartCollection.updateOne(
        { userId },
        { $pull: { items: bookId } }
      );
    
      if (result.modifiedCount > 0) {
        res.send({ success: true });
      } else {
        res.status(404).json({ error: "Cart or item not found" });
      }
    });
    








    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
