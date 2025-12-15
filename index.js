const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1r2gfjh.mongodb.net/?appName=Cluster0`;

app.get("/", (req, res) => {
  res.send("Local bazaar server is running!");
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("mealsDB");
    const mealsCollection = db.collection("meals");
    const ordersCollection = db.collection("order_collection");

    // save meals in db

    app.post("/meals", async (req, res) => {
      const mealsData = req.body;
      const result = await mealsCollection.insertOne(mealsData);
      res.send(result);
    });

    //get all meals from db

    app.get("/meals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    //find one data
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // order related api
    app.post("/orders", async (req, res) => {
      const orderData = req.body;
      orderData.orderTime = new Date();
      const result = await ordersCollection.insertOne(orderData);
      res.send(result);
    });
    // logIn user orders
    app.get("/orders", async (req, res) => {
      const email = req.query.email;
      const query = email ? { userEmail: email } : {};
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    // payment related API

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { orderId, totalPrice } = req.body;

        console.log("Payment Request:", orderId, totalPrice);

        if (!orderId || !totalPrice) {
          return res
            .status(400)
            .send({ error: "Missing orderId or totalPrice" });
        }

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Meal Order Payment",
                },
                unit_amount: Math.round(totalPrice * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
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
